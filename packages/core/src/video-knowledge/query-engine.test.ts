import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

async function withIsolatedWorkspace<T>(run: () => Promise<T>): Promise<T> {
  const workDir = await mkdtemp(path.join(tmpdir(), 'larkup-video-query-engine-'));
  const originalCwd = process.cwd();
  process.chdir(workDir);
  try {
    return await run();
  } finally {
    process.chdir(originalCwd);
    await rm(workDir, { recursive: true, force: true });
  }
}

test('scanVideoKnowledge: pages a complete source inventory chronologically without ranking', async () => {
  await withIsolatedWorkspace(async () => {
    const { createProject, runWithProject } = await import('../project-store');
    const { mutateVideoKnowledgeState } = await import('./store');
    const { DEFAULT_VIDEO_CONFIDENCE } = await import('./types');
    const { scanVideoKnowledge } = await import('./query-engine');
    const { project } = await createProject('Deterministic source inventory');

    await runWithProject(project.id, async () => {
      const mediaAssetId = 'recording';
      const knowledgeRevisionId = 'revision-1';
      const createdAt = new Date().toISOString();
      const evidence = [
        {
          id: 'coverage',
          lineageId: 'coverage',
          startSecs: 0,
          text: 'Source inventory coverage: complete',
        },
        {
          id: 'first-question',
          lineageId: 'first-question',
          startSecs: 12,
          text: 'Source question (spoken): What is the rule?\nSource answer: The rule is one attempt.\nSource respondent: Mina',
        },
        {
          id: 'second-question',
          lineageId: 'second-question',
          startSecs: 88,
          text: 'Source question (spoken): Who goes next?',
        },
      ];
      await mutateVideoKnowledgeState((state) => {
        state.manifests.push({
          id: 'manifest-1',
          mediaAssetId,
          knowledgeRevisionId,
          activeEvidenceRevisionIds: Object.fromEntries(
            evidence.map((item) => [item.lineageId, item.id]),
          ),
          activeObservationRevisionIds: {},
          activeProjectionIds: [],
          activationReason: 'initial',
          schemaVersion: 1,
          createdAt,
          activatedAt: createdAt,
        } as never);
        state.evidence.push(
          ...evidence.map((item) => ({
            id: item.id,
            lineageId: item.lineageId,
            mediaAssetId,
            knowledgeRevisionId,
            modality: 'transcript' as const,
            timeRange: {
              startSecs: item.startSecs,
              endSecs: item.startSecs + 4,
              precision: 'segment' as const,
            },
            payload: { text: item.text },
            source: { kind: 'provider' as const, provider: 'test' },
            confidence: DEFAULT_VIDEO_CONFIDENCE,
            schemaVersion: 1 as const,
            createdAt,
          })),
        );
      });

      const first = await scanVideoKnowledge(mediaAssetId, {
        kind: 'source-inventory',
        limit: 1,
      });
      assert.ok(first);
      assert.equal(first.coverage.complete, true);
      assert.equal(first.records[0]?.text, 'What is the rule?');
      assert.equal(first.records[0]?.answer, 'The rule is one attempt.');
      assert.equal(first.records[0]?.respondent, 'Mina');
      assert.equal(first.continuation.hasMore, true);

      const second = await scanVideoKnowledge(mediaAssetId, {
        kind: 'source-inventory',
        cursor: first.continuation.nextCursor,
        limit: 1,
      });
      assert.ok(second);
      assert.equal(second.records[0]?.text, 'Who goes next?');
      assert.equal(second.continuation.hasMore, false);

      const fullIndex = await scanVideoKnowledge(mediaAssetId, { kind: 'all-evidence', limit: 10 });
      assert.ok(fullIndex);
      assert.equal(fullIndex.coverage.complete, true);
      assert.equal(fullIndex.records.length, 3);

      await mutateVideoKnowledgeState((state) => {
        const marker = state.evidence.findIndex((item) => item.id === 'coverage');
        if (marker >= 0) state.evidence.splice(marker, 1);
      });
      const missingMarker = await scanVideoKnowledge(mediaAssetId, { kind: 'all-evidence' });
      assert.ok(missingMarker);
      assert.equal(missingMarker.coverage.complete, false);
      assert.match(missingMarker.coverage.reason ?? '', /no complete-source inventory marker/i);
    });
  });
});

test('aggregateVideoKnowledge: retains a revision-scoped navigation map outside chat context', async () => {
  await withIsolatedWorkspace(async () => {
    const { createProject, runWithProject } = await import('../project-store');
    const { mutateVideoKnowledgeState } = await import('./store');
    const { DEFAULT_VIDEO_CONFIDENCE } = await import('./types');
    const { aggregateVideoKnowledge } = await import('./query-engine');
    const { project } = await createProject('Durable aggregate');

    await runWithProject(project.id, async () => {
      const mediaAssetId = 'recording';
      const knowledgeRevisionId = 'revision-1';
      const createdAt = new Date().toISOString();
      await mutateVideoKnowledgeState((state) => {
        state.manifests.push({
          id: 'manifest-1',
          mediaAssetId,
          knowledgeRevisionId,
          activeEvidenceRevisionIds: {
            present: 'present-evidence',
            person: 'person-evidence',
            sightings: 'sightings-evidence',
            inventory: 'inventory-evidence',
          },
          activeObservationRevisionIds: {},
          activeProjectionIds: [],
          activationReason: 'initial',
          schemaVersion: 1,
          createdAt,
          activatedAt: createdAt,
        } as never);
        state.evidence.push(
          {
            id: 'present-evidence',
            lineageId: 'present',
            mediaAssetId,
            knowledgeRevisionId,
            modality: 'visual',
            timeRange: { startSecs: 12, endSecs: 16, precision: 'frame' },
            payload: {
              text: 'Present: Zizo — contestant shown on the challenge scoreboard',
            },
            source: { kind: 'provider', provider: 'test' },
            confidence: DEFAULT_VIDEO_CONFIDENCE,
            schemaVersion: 1,
            createdAt,
          },
          {
            id: 'person-evidence',
            lineageId: 'person',
            mediaAssetId,
            knowledgeRevisionId,
            modality: 'visual',
            timeRange: { startSecs: 20, endSecs: 24, precision: 'frame' },
            payload: {
              text: 'Reconciled participant: Rami — wearing a black t-shirt',
            },
            source: { kind: 'provider', provider: 'test' },
            confidence: DEFAULT_VIDEO_CONFIDENCE,
            schemaVersion: 1,
            createdAt,
          },
          {
            id: 'sightings-evidence',
            lineageId: 'sightings',
            mediaAssetId,
            knowledgeRevisionId,
            modality: 'visual',
            timeRange: { startSecs: 20, endSecs: 27, precision: 'frame' },
            payload: {
              text:
                'Visible subject: {"identity":"Rami","identityBasis":"source-named","startMs":20000,"endMs":24000}\n' +
                'Visible subject: {"identity":"Rami","identityBasis":"source-named","startMs":23000,"endMs":27000}',
            },
            source: { kind: 'provider', provider: 'test' },
            confidence: DEFAULT_VIDEO_CONFIDENCE,
            schemaVersion: 1,
            createdAt,
          },
          {
            id: 'inventory-evidence',
            lineageId: 'inventory',
            mediaAssetId,
            knowledgeRevisionId,
            modality: 'transcript',
            timeRange: { startSecs: 30, endSecs: 36, precision: 'segment' },
            payload: { text: 'Source inventory coverage: complete' },
            source: { kind: 'provider', provider: 'test' },
            confidence: DEFAULT_VIDEO_CONFIDENCE,
            schemaVersion: 1,
            createdAt,
          },
        );
      });

      const first = await aggregateVideoKnowledge(mediaAssetId);
      assert.ok(first);
      assert.equal(first.cached, false);
      assert.deepEqual(first.participants, [
        {
          name: 'Zizo',
          description: 'contestant shown on the challenge scoreboard',
          timeRange: { startSecs: 12, endSecs: 16, precision: 'frame' },
        },
        {
          name: 'Rami',
          description: 'wearing a black t-shirt',
          timeRange: { startSecs: 20, endSecs: 24, precision: 'frame' },
        },
      ]);
      assert.deepEqual(first.visibleSubjects, [
        {
          identity: 'Rami',
          identityBasis: 'source-named',
          appearances: [{ startSecs: 20, endSecs: 27, precision: 'estimated' }],
          observedDurationSecs: 7,
          observationCount: 2,
        },
      ]);
      const cached = await aggregateVideoKnowledge(mediaAssetId);
      assert.ok(cached);
      assert.equal(cached.cached, true);
      assert.equal(cached.resultHandle, first.resultHandle);
    });
  });
});

test('scanVideoKnowledge: collapses overlapping duplicate source inventory records and retains answers', async () => {
  await withIsolatedWorkspace(async () => {
    const { createProject, runWithProject } = await import('../project-store');
    const { mutateVideoKnowledgeState } = await import('./store');
    const { DEFAULT_VIDEO_CONFIDENCE } = await import('./types');
    const { scanVideoKnowledge } = await import('./query-engine');
    const { project } = await createProject('Collapsed source inventory');

    await runWithProject(project.id, async () => {
      const mediaAssetId = 'recording';
      const knowledgeRevisionId = 'revision-1';
      const createdAt = new Date().toISOString();
      const evidence = [
        { id: 'coverage', startSecs: 0, text: 'Source inventory coverage: complete' },
        { id: 'question-1', startSecs: 12, text: 'Source question (spoken): Who goes next?' },
        {
          id: 'question-2',
          startSecs: 18,
          text: 'Source question (spoken): Who goes next?\nSource answer: Rami.\nSource respondent: Mina',
        },
        { id: 'question-3', startSecs: 200, text: 'Source question (spoken): Who goes next?' },
      ];
      await mutateVideoKnowledgeState((state) => {
        state.manifests.push({
          id: 'manifest-1',
          mediaAssetId,
          knowledgeRevisionId,
          activeEvidenceRevisionIds: Object.fromEntries(evidence.map((item) => [item.id, item.id])),
          activeObservationRevisionIds: {},
          activeProjectionIds: [],
          activationReason: 'initial',
          schemaVersion: 1,
          createdAt,
          activatedAt: createdAt,
        } as never);
        state.evidence.push(
          ...evidence.map((item) => ({
            id: item.id,
            lineageId: item.id,
            mediaAssetId,
            knowledgeRevisionId,
            modality: 'transcript' as const,
            timeRange: {
              startSecs: item.startSecs,
              endSecs: item.startSecs + 4,
              precision: 'segment' as const,
            },
            payload: { text: item.text },
            source: { kind: 'provider' as const, provider: 'test' },
            confidence: DEFAULT_VIDEO_CONFIDENCE,
            schemaVersion: 1 as const,
            createdAt,
          })),
        );
      });

      const scan = await scanVideoKnowledge(mediaAssetId, { kind: 'source-inventory' });
      assert.ok(scan);
      assert.equal(scan.records.length, 2);
      assert.deepEqual(
        scan.records.map((item) => item.text),
        ['Who goes next?', 'Who goes next?'],
      );
      assert.equal(scan.records[0]?.answer, 'Rami.');
      assert.equal(scan.records[0]?.respondent, 'Mina');
      assert.equal(scan.records[0]?.timeRange.startSecs, 12);
      assert.equal(scan.records[0]?.timeRange.endSecs, 22);
    });
  });
});

test('scanVideoKnowledge: preserves source structure while identifying primary questions', async () => {
  await withIsolatedWorkspace(async () => {
    const { createProject, runWithProject } = await import('../project-store');
    const { mutateVideoKnowledgeState } = await import('./store');
    const { DEFAULT_VIDEO_CONFIDENCE } = await import('./types');
    const { scanVideoKnowledge } = await import('./query-engine');
    const { project } = await createProject('Structured source inventory');

    await runWithProject(project.id, async () => {
      const createdAt = new Date().toISOString();
      const mediaAssetId = 'recording';
      const evidence = [
        { id: 'coverage', startSecs: 0, text: 'Source inventory coverage: complete' },
        {
          id: 'chat',
          startSecs: 1,
          text: 'Source question (spoken, interactional): How are you?\nSource answer: Fine.',
        },
        {
          id: 'prompt',
          startSecs: 10,
          text: 'Source question (visible, primary): Which option is correct?',
        },
        {
          id: 'continued-prompt',
          startSecs: 15,
          text: 'Source question (visible, primary): Which option is correct?\nSource task id: task-15',
        },
        {
          id: 'clue',
          startSecs: 18,
          text: 'Source item (clue, visible): I worked with Alpha and Beta.',
        },
        {
          id: 'layout',
          startSecs: 20,
          text: 'Source structure (grid): Topics\nSource dimensions: Topic = History, Science | Level = 200, 400\nSource prompt slots: 4',
        },
      ];
      await mutateVideoKnowledgeState((state) => {
        state.manifests.push({
          id: 'manifest',
          mediaAssetId,
          knowledgeRevisionId: 'revision',
          activeEvidenceRevisionIds: Object.fromEntries(evidence.map((item) => [item.id, item.id])),
          activeObservationRevisionIds: {},
          activeProjectionIds: [],
          activationReason: 'initial',
          schemaVersion: 1,
          createdAt,
          activatedAt: createdAt,
        } as never);
        state.evidence.push(
          ...evidence.map((item) => ({
            id: item.id,
            lineageId: item.id,
            mediaAssetId,
            knowledgeRevisionId: 'revision',
            modality: 'computed' as const,
            timeRange: {
              startSecs: item.startSecs,
              endSecs: item.startSecs + 1,
              precision: 'segment' as const,
            },
            payload: { text: item.text },
            source: { kind: 'provider' as const, provider: 'test' },
            confidence: DEFAULT_VIDEO_CONFIDENCE,
            schemaVersion: 1 as const,
            createdAt,
          })),
        );
      });

      const scan = await scanVideoKnowledge(mediaAssetId, { kind: 'source-inventory', limit: 10 });
      assert.ok(scan);
      assert.deepEqual(
        scan.records.map((record) => [record.kind, record.questionRole, record.text]),
        [
          ['question', 'interactional', 'How are you?'],
          ['question', 'primary', 'Which option is correct?'],
          ['question', 'primary', 'Which option is correct?'],
          ['clue', undefined, 'I worked with Alpha and Beta.'],
          ['structure', undefined, 'Topics\nTopic = History, Science | Level = 200, 400'],
        ],
      );
      assert.equal(scan.records[2]?.taskId, 'task-15');
      assert.equal(scan.records[4]?.promptSlots, 4);
    });
  });
});
