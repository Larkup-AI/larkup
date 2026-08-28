import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * Acceptance tests for the agentic investigation loop, per the launch
 * checklist's item 7: answers absent from transcript/captions, requiring
 * either (a) calculation across multiple timestamps, or (b) visual action
 * retrieval found only through Qwen3-VL-Embedding + watch_original/run_code.
 *
 * (a) is fully real and runnable here: real evidence-graph state, real
 * read_evidence-equivalent retrieval (searchVideoKnowledge), real
 * cross-timestamp reasoning over its output.
 *
 * (b) is honestly partial. The retrieval *infrastructure* is real end to
 * end (see video-embedding-index.test.ts: real LanceDB upsert/query, a real
 * HTTP server standing in for DashScope's multimodal-embedding endpoint).
 * What is NOT yet verified is the model's actual judgment -- whether it
 * correctly embeds "a person raises their hand" near the right clip --
 * because a real call reached DashScope and was rejected with
 * AccessDenied.Unpurchased, meaning the model needs one-time activation in
 * the Alibaba Cloud Model Studio console (see
 * runtime/app/services/embedding.py's docstring and README.md). This test
 * exercises the full call chain with a stand-in embedding and says so
 * explicitly, rather than mocking away the part that is actually unverified.
 */

async function withIsolatedWorkspace<T>(run: () => Promise<T>): Promise<T> {
  const workDir = await mkdtemp(path.join(tmpdir(), 'larkup-video-acceptance-'));
  const originalCwd = process.cwd();
  process.chdir(workDir);
  try {
    return await run();
  } finally {
    process.chdir(originalCwd);
    await rm(workDir, { recursive: true, force: true });
  }
}

/** Stands in for DashScope's multimodal-embedding endpoint. */
function startFixedVectorServer(vector: number[]): Promise<{ url: string; server: Server }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ output: { embeddings: [{ embedding: vector }] } }));
        void body;
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ url: `http://127.0.0.1:${port}`, server });
    });
  });
}

test('acceptance: cross-timestamp calculation from visual-only evidence (no transcript)', async () => {
  await withIsolatedWorkspace(async () => {
    const { runWithProject, createProject } = await import('../project-store');
    const { mutateVideoKnowledgeState } = await import('./store');
    const { searchVideoKnowledge } = await import('./retrieval');
    const { DEFAULT_VIDEO_CONFIDENCE } = await import('./types');

    const { project } = await createProject('Acceptance Test A');

    await runWithProject(project.id, async () => {
      const mediaAssetId = 'match-video';
      const revisionId = 'rev-1';
      const createdAt = new Date().toISOString();

      // A scoreboard OCR trail is the only evidence -- no transcript exists
      // for this asset at all. The question "how many goals in the second
      // half" is answerable only by reading two OCR readings and
      // subtracting, exactly the shape of evidence my real Modal smoke
      // test produced this session (OCR correctly read "SCORE 3-1" off a
      // real GPU-processed video with zero transcript).
      await mutateVideoKnowledgeState((state) => {
        state.manifests.push({
          id: 'manifest-1',
          mediaAssetId,
          knowledgeRevisionId: revisionId,
          activeEvidenceRevisionIds: {
            'lineage-1': 'evidence-1',
            'lineage-2': 'evidence-2',
            'lineage-3': 'evidence-3',
          },
          activeObservationRevisionIds: {},
          activeProjectionIds: [],
          activationReason: 'initial',
          schemaVersion: 1,
          createdAt,
          activatedAt: createdAt,
        });
        const ocrEvidence = (id: string, lineageId: string, startSecs: number, text: string) => ({
          id,
          lineageId,
          mediaAssetId,
          knowledgeRevisionId: revisionId,
          modality: 'ocr' as const,
          timeRange: { startSecs, endSecs: startSecs + 1, precision: 'frame' as const },
          payload: { text },
          source: { kind: 'provider' as const, provider: 'paddleocr' },
          confidence: DEFAULT_VIDEO_CONFIDENCE,
          schemaVersion: 1 as const,
          createdAt,
        });
        state.evidence.push(
          ocrEvidence('evidence-1', 'lineage-1', 600, 'SCORE 1-0'),
          ocrEvidence('evidence-2', 'lineage-2', 2700, 'SCORE 2-0'),
          ocrEvidence('evidence-3', 'lineage-3', 5100, 'SCORE 3-1'),
        );
      });

      // read_evidence's actual implementation (search with an empty query,
      // scoped to a time range) -- second-half kickoff at 2700s to the end.
      const secondHalfEvidence = await searchVideoKnowledge(mediaAssetId, '', 10, {
        minimumRangeDistanceSecs: 0,
        timeRange: { startSecs: 2700, endSecs: 5200 },
      });
      const chronological = [...secondHalfEvidence].sort(
        (a, b) => a.evidence.timeRange.startSecs - b.evidence.timeRange.startSecs,
      );
      assert.equal(chronological.length, 2);

      const scoreOf = (text: string) => {
        const match = text.match(/(\d+)-(\d+)/);
        assert.ok(match);
        return Number(match[1]) + Number(match[2]);
      };
      const firstReading = (chronological[0].evidence.payload as { text: string }).text;
      const lastReading = (chronological[chronological.length - 1].evidence.payload as { text: string })
        .text;
      const goalsInSecondHalf = scoreOf(lastReading) - scoreOf(firstReading);

      // This is exactly the run_code step: a deterministic calculation over
      // read_evidence's chronological output, not a language-model guess.
      assert.equal(goalsInSecondHalf, 2);

      // The full-match trail (no time bound) confirms the transcript
      // channel genuinely has nothing -- the answer could only have come
      // from visual/OCR evidence.
      const transcriptOnly = await searchVideoKnowledge(mediaAssetId, '', 10, {
        modalities: ['transcript'],
        minimumRangeDistanceSecs: 0,
      });
      assert.deepEqual(transcriptOnly, []);
    });
  });
});

test('acceptance: retrieves a terminal spoken outcome even when team names are absent there', async () => {
  await withIsolatedWorkspace(async () => {
    const { runWithProject, createProject } = await import('../project-store');
    const { mutateVideoKnowledgeState } = await import('./store');
    const { searchVideoKnowledge } = await import('./retrieval');
    const { planVideoQuestion } = await import('./query-planner');
    const { DEFAULT_VIDEO_CONFIDENCE } = await import('./types');
    const { project } = await createProject('Terminal Outcome Retrieval');

    await runWithProject(project.id, async () => {
      const mediaAssetId = 'captain-gomaa-episode-10';
      const revisionId = 'terminal-outcome-revision';
      const createdAt = new Date().toISOString();
      await mutateVideoKnowledgeState((state) => {
        state.manifests.push({
          id: 'terminal-outcome-manifest',
          mediaAssetId,
          knowledgeRevisionId: revisionId,
          activeEvidenceRevisionIds: {
            teams: 'teams-evidence',
            conclusion: 'conclusion-evidence',
          },
          activeObservationRevisionIds: {},
          activeProjectionIds: [],
          activationReason: 'initial',
          schemaVersion: 1,
          createdAt,
          activatedAt: createdAt,
        });
        state.evidence.push(
          {
            id: 'teams-evidence',
            lineageId: 'teams',
            mediaAssetId,
            knowledgeRevisionId: revisionId,
            modality: 'transcript',
            timeRange: { startSecs: 120, endSecs: 128, precision: 'word' },
            payload: { text: 'دكتور عبد العزيز ومعتز ضد رجب ورمزي' },
            source: { kind: 'provider', provider: 'test-stt' },
            confidence: DEFAULT_VIDEO_CONFIDENCE,
            schemaVersion: 1,
            createdAt,
          },
          {
            id: 'conclusion-evidence',
            lineageId: 'conclusion',
            mediaAssetId,
            knowledgeRevisionId: revisionId,
            modality: 'transcript',
            timeRange: { startSecs: 4266, endSecs: 4269, precision: 'word' },
            // The actual video's terminal transcript says "تعادل" without
            // restating the competing teams. This is a regression fixture,
            // not a runtime rule for Arabic, matches, or draws.
            payload: { text: 'تعادل تعادل' },
            source: { kind: 'provider', provider: 'test-stt' },
            confidence: DEFAULT_VIDEO_CONFIDENCE,
            schemaVersion: 1,
            createdAt,
          },
        );
      });

      const question = 'من فاز في هذه المباراة: دكتور عبد العزيز ومعتز ضد رجب ورمزي؟';
      const plan = planVideoQuestion(question);
      assert.ok(plan.kinds.includes('outcome'));
      const hits = await searchVideoKnowledge(mediaAssetId, question, 8, {
        queryPlan: plan,
        videoDurationSecs: 4357,
        minimumRangeDistanceSecs: 0,
      });
      assert.ok(
        hits.some((hit) => JSON.stringify(hit.evidence.payload).includes('تعادل')),
        'the terminal spoken conclusion must be available to the answerer',
      );
    });
  });
});

test('acceptance: visual action retrieval infrastructure (model correctness pending Model Studio activation)', async () => {
  await withIsolatedWorkspace(async () => {
    const { runWithProject, createProject } = await import('../project-store');
    const { upsertVideoEmbeddings, queryVideoEmbeddings } = await import(
      './video-embedding-index'
    );

    const { project } = await createProject('Acceptance Test B');

    await runWithProject(project.id, async () => {
      const mediaAssetId = 'handoff-video';

      // A clip embedding with no corresponding caption/OCR/transcript text
      // anywhere -- the only way to find it is by visual similarity, which
      // is exactly what a caption-only or lexical search cannot do.
      await upsertVideoEmbeddings(mediaAssetId, 'rev-1', [
        { clipId: 'clip_0', startSecs: 0, endSecs: 8, vector: [1, 0, 0, 0], provider: 'qwen3-vl-embedding' },
        { clipId: 'clip_1', startSecs: 8, endSecs: 16, vector: [0, 1, 0, 0], provider: 'qwen3-vl-embedding' },
        { clipId: 'clip_2', startSecs: 16, endSecs: 24, vector: [0, 0, 1, 0], provider: 'qwen3-vl-embedding' },
      ]);

      // Stands in for DashScope's multimodal-embedding endpoint (real call
      // chain, verified in video-embedding-index.test.ts). The vector
      // returned here is a fixed stand-in, NOT the model's actual judgment
      // about the query text -- that model-level correctness is the one
      // piece still pending Model Studio activation (see this file's
      // header comment).
      const { url, server } = await startFixedVectorServer([0, 1, 0, 0]);
      const previousKey = process.env.DASHSCOPE_API_KEY;
      const previousUrl = process.env.LARKUP_VIDEO_DASHSCOPE_BASE_URL;
      process.env.DASHSCOPE_API_KEY = 'test-key';
      process.env.LARKUP_VIDEO_DASHSCOPE_BASE_URL = url;
      try {
        const matches = await queryVideoEmbeddings(mediaAssetId, 'a person hands off an object', 3);
        assert.ok(matches.length > 0);
        assert.equal(matches[0].clipId, 'clip_1');
        assert.equal(matches[0].startSecs, 8);
        assert.equal(matches[0].endSecs, 16);
        // The agent's next real step on a genuine miss like this is
        // watch_original(startSecs, endSecs, question) on the top match --
        // exercised by inspectVideoKnowledge's route, not re-tested here.
      } finally {
        server.close();
        if (previousKey === undefined) delete process.env.DASHSCOPE_API_KEY;
        else process.env.DASHSCOPE_API_KEY = previousKey;
        if (previousUrl === undefined) delete process.env.LARKUP_VIDEO_DASHSCOPE_BASE_URL;
        else process.env.LARKUP_VIDEO_DASHSCOPE_BASE_URL = previousUrl;
      }
    });
  });
});
