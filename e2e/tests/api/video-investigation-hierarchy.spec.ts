import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const repoRoot = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');

test('plans every video question from a cached chapter, scene, event, and state hierarchy', async () => {
  const { createVideoKnowledgeRevision } = await import(
    `${repoRoot}/packages/core/src/video-knowledge/revision-store`
  );
  const { buildVideoKnowledgeFromEvidence } = await import(
    `${repoRoot}/packages/core/src/video-knowledge/knowledge-builder`
  );
  const { activateVideoKnowledgeManifest } = await import(
    `${repoRoot}/packages/core/src/video-knowledge/manifest-store`
  );
  const { planVideoInvestigation } = await import(
    `${repoRoot}/packages/core/src/video-knowledge/investigation`
  );

  const mediaAssetId = randomUUID();
  const revision = await createVideoKnowledgeRevision({
    mediaAssetId,
    sourceFingerprint: 'hierarchy-test',
    pipelineVersion: 'test-v1',
    budget: { maxDurationSecs: 90, maxBytes: 1024, maxFrames: 10, maxModelCalls: 0, maxCostUsd: 0 },
    coverage: {
      sourceDurationSecs: 90,
      inspectedRanges: [],
      transcriptCoverage: 1,
      visualCoverage: 0,
      ocrCoverage: 0,
      partialReasons: [],
    },
  });
  const built = await buildVideoKnowledgeFromEvidence({
    mediaAssetId,
    knowledgeRevisionId: revision.id,
    evidence: [
      {
        modality: 'visual',
        timeRange: { startSecs: 12, endSecs: 13, precision: 'estimated' },
        payload: { text: 'A blue box is placed on the shelf.' },
        source: { kind: 'provider' },
        confidence: {
          score: 0.8,
          source: 'provider',
          calibrationStatus: 'uncalibrated',
          uncertaintyReasons: [],
        },
        observation: {
          kind: 'state',
          value: { subject: 'blue box', property: 'location', value: 'shelf' },
        },
      },
      {
        modality: 'visual',
        timeRange: { startSecs: 43, endSecs: 44, precision: 'estimated' },
        payload: { text: 'The blue box is no longer visible beside the exit.' },
        source: { kind: 'provider' },
        confidence: {
          score: 0.8,
          source: 'provider',
          calibrationStatus: 'uncalibrated',
          uncertaintyReasons: [],
        },
        observation: {
          kind: 'state',
          value: { subject: 'blue box', property: 'location', value: 'not visible' },
        },
      },
    ],
  });
  await activateVideoKnowledgeManifest({
    mediaAssetId,
    knowledgeRevisionId: revision.id,
    activeEvidenceRevisionIds: Object.fromEntries(
      built.evidenceLineageIds.map((lineageId: string, index: number) => [
        lineageId,
        built.evidenceIds[index],
      ]),
    ),
    activeObservationRevisionIds: Object.fromEntries(
      built.observationLineageIds.map((lineageId: string, index: number) => [
        lineageId,
        built.observationIds[index],
      ]),
    ),
    activeProjectionIds: [],
    activationReason: 'initial',
  });

  const first = await planVideoInvestigation(
    mediaAssetId,
    'Where was the blue box before it disappeared?',
  );
  expect(first?.cache).toBe('miss');
  expect(first?.states.map((state: { summary: string }) => state.summary)).toEqual(
    expect.arrayContaining(['shelf', 'not visible']),
  );
  expect(first?.candidateRanges.map((range: { startSecs: number }) => range.startSecs)).toContain(
    12,
  );

  const second = await planVideoInvestigation(
    mediaAssetId,
    'Where was the blue box before it disappeared?',
  );
  expect(second?.cache).toBe('hit');
  expect(second?.chapters.length).toBeGreaterThan(0);
  expect(second?.scenes.length).toBeGreaterThan(0);
});
