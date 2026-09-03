import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * Ranking behaviour that a question asked in one language, about a source
 * recorded in another, depends on. Lexical overlap is zero in that case, so
 * everything here turns on the graded semantic score supplied by
 * `evidence-semantic-index` and on not letting recogniser fragments crowd out
 * the readings that can actually support a claim.
 */

async function withIsolatedWorkspace<T>(run: () => Promise<T>): Promise<T> {
  const workDir = await mkdtemp(path.join(tmpdir(), 'larkup-video-retrieval-'));
  const originalCwd = process.cwd();
  process.chdir(workDir);
  try {
    return await run();
  } finally {
    process.chdir(originalCwd);
    await rm(workDir, { recursive: true, force: true });
  }
}

const MEDIA_ASSET_ID = 'episode';
const REVISION_ID = 'revision-1';

interface Fixture {
  id: string;
  modality: 'transcript' | 'ocr' | 'visual' | 'computed';
  startSecs: number;
  text: string;
}

async function seed(fixtures: Fixture[]) {
  const { mutateVideoKnowledgeState } = await import('./store');
  const { DEFAULT_VIDEO_CONFIDENCE } = await import('./types');
  const createdAt = new Date().toISOString();
  await mutateVideoKnowledgeState((state) => {
    state.manifests.push({
      id: 'manifest-1',
      mediaAssetId: MEDIA_ASSET_ID,
      knowledgeRevisionId: REVISION_ID,
      activeEvidenceRevisionIds: Object.fromEntries(
        fixtures.map((fixture) => [`lineage-${fixture.id}`, fixture.id]),
      ),
      activeObservationRevisionIds: {},
      activeProjectionIds: [],
      activationReason: 'initial',
      schemaVersion: 1,
      createdAt,
      activatedAt: createdAt,
    } as never);
    for (const fixture of fixtures) {
      state.evidence.push({
        id: fixture.id,
        lineageId: `lineage-${fixture.id}`,
        mediaAssetId: MEDIA_ASSET_ID,
        knowledgeRevisionId: REVISION_ID,
        modality: fixture.modality,
        timeRange: {
          startSecs: fixture.startSecs,
          endSecs: fixture.startSecs + 5,
          precision: 'estimated',
        },
        payload: { text: fixture.text },
        source: { kind: 'provider', provider: 'test' },
        confidence: DEFAULT_VIDEO_CONFIDENCE,
        schemaVersion: 1,
        createdAt,
      } as never);
    }
  });
}

// The failure this fixes: an English question against an Arabic recording has
// no lexical overlap with anything, so every record scored identically and the
// reading that answered the question never reached the top of the list.
test('searchVideoKnowledge: a graded semantic score ranks evidence sharing no wording with the question', async () => {
  await withIsolatedWorkspace(async () => {
    const { runWithProject, createProject } = await import('../project-store');
    const { searchVideoKnowledge } = await import('./retrieval');
    const { project } = await createProject('Graded semantic ranking');

    await runWithProject(project.id, async () => {
      await seed([
        {
          id: 'noise',
          modality: 'visual',
          startSecs: 10,
          text: 'A wide shot of an empty studio set',
        },
        {
          id: 'answer',
          modality: 'visual',
          startSecs: 2_800,
          text: 'مصطفى فاز على محمد في الجولة الأخيرة',
        },
      ]);

      const withoutSemantics = await searchVideoKnowledge(MEDIA_ASSET_ID, 'who won', 5);
      assert.equal(withoutSemantics.length, 0, 'lexical retrieval alone finds nothing here');

      const withSemantics = await searchVideoKnowledge(MEDIA_ASSET_ID, 'who won', 5, {
        semanticScores: new Map([
          ['answer', 1],
          ['noise', 0.2],
        ]),
      });
      assert.equal(withSemantics[0]?.evidence.id, 'answer');
    });
  });
});

// Speech recognition on conversational audio emits hundreds of one- and
// two-word fragments. They tied on every other component and filled the result.
test('searchVideoKnowledge: recogniser fragments do not crowd out readings that can support a claim', async () => {
  await withIsolatedWorkspace(async () => {
    const { runWithProject, createProject } = await import('../project-store');
    const { searchVideoKnowledge } = await import('./retrieval');
    const { project } = await createProject('Fragment weighting');

    await runWithProject(project.id, async () => {
      const fragments: Fixture[] = Array.from({ length: 10 }, (_, index) => ({
        id: `fragment-${index}`,
        modality: 'transcript' as const,
        startSecs: index * 30,
        text: 'مين',
      }));
      await seed([
        ...fragments,
        {
          id: 'reading',
          modality: 'visual',
          startSecs: 400,
          text: 'The scoreboard shows the right team finishing ahead of the left team at the end of the round',
        },
      ]);

      const semanticScores = new Map<string, number>([
        ...fragments.map((fragment) => [fragment.id, 0.9] as const),
        ['reading', 0.9],
      ]);
      const hits = await searchVideoKnowledge(MEDIA_ASSET_ID, 'who won', 5, { semanticScores });
      assert.equal(
        hits[0]?.evidence.id,
        'reading',
        'a fragment scoring as well semantically must still rank below a full reading',
      );
    });
  });
});

test('searchVideoKnowledge: evidence the semantic pass never surfaced stays out of the result', async () => {
  await withIsolatedWorkspace(async () => {
    const { runWithProject, createProject } = await import('../project-store');
    const { searchVideoKnowledge } = await import('./retrieval');
    const { project } = await createProject('Semantic relevance gate');

    await runWithProject(project.id, async () => {
      await seed([
        {
          id: 'matched',
          modality: 'visual',
          startSecs: 10,
          text: 'A relevant reading of the moment',
        },
        { id: 'unmatched', modality: 'visual', startSecs: 900, text: 'Something else entirely' },
      ]);
      const hits = await searchVideoKnowledge(MEDIA_ASSET_ID, 'قصة مختلفة', 5, {
        semanticScores: new Map([['matched', 0.8]]),
      });
      assert.deepEqual(
        hits.map((hit) => hit.evidence.id),
        ['matched'],
      );
    });
  });
});

test('searchVideoKnowledge: an echoed failed request cannot outrank source evidence', async () => {
  await withIsolatedWorkspace(async () => {
    const { runWithProject, createProject } = await import('../project-store');
    const { searchVideoKnowledge } = await import('./retrieval');
    const { planVideoQuestion } = await import('./query-planner');
    const { project } = await createProject('Inspection echo ranking');

    await runWithProject(project.id, async () => {
      await seed([
        {
          id: 'failed-look',
          modality: 'visual',
          startSecs: 2_950,
          text: 'An unrelated closing card.\nClaim question: which side finished ahead\nClaim verdict: not-established',
        },
        {
          id: 'source-reading',
          modality: 'visual',
          startSecs: 2_850,
          text: 'The right side finished ahead while the left side remained behind.',
        },
      ]);

      const hits = await searchVideoKnowledge(MEDIA_ASSET_ID, 'which side finished ahead', 5, {
        queryPlan: planVideoQuestion('which side finished ahead'),
        videoDurationSecs: 3_000,
      });
      assert.equal(hits[0]?.evidence.id, 'source-reading');
      assert.ok((hits[0]?.components.lexical ?? 0) > 0);
      const failed = hits.find((hit) => hit.evidence.id === 'failed-look');
      assert.ok(!failed || failed.components.lexical === 0);
    });
  });
});

test('searchVideoKnowledge: duplicate revisions are collapsed before temporal candidates are trimmed', async () => {
  await withIsolatedWorkspace(async () => {
    const { runWithProject, createProject } = await import('../project-store');
    const { searchVideoKnowledge } = await import('./retrieval');
    const { planVideoQuestion } = await import('./query-planner');
    const { project } = await createProject('Temporal diversity');

    await runWithProject(project.id, async () => {
      const repeated: Fixture[] = Array.from({ length: 100 }, (_, index) => ({
        id: `repeat-${index}`,
        modality: 'computed',
        startSecs: 2_800,
        text: `which side finished ahead interim reading ${index}`,
      }));
      await seed([
        ...repeated,
        {
          id: 'later-source-reading',
          modality: 'computed',
          startSecs: 2_850,
          text: 'The right side finished ahead in the final reading.',
        },
      ]);

      const question = 'which side finished ahead';
      const hits = await searchVideoKnowledge(MEDIA_ASSET_ID, question, 16, {
        queryPlan: planVideoQuestion(question),
        videoDurationSecs: 3_000,
      });
      assert.ok(hits.some((hit) => hit.evidence.id === 'later-source-reading'));
      assert.equal(hits.filter((hit) => hit.evidence.id.startsWith('repeat-')).length, 1);
    });
  });
});
