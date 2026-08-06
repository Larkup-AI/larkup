import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { scoreVideoKnowledgeEvaluation } from '../../../packages/core/src/video-knowledge/evaluation';
import { decideInspection } from '../../../packages/core/src/video-knowledge/inspection-policy';
import { planVideoQuestion } from '../../../packages/core/src/video-knowledge/query-planner';
import {
  videoKnowledgeRetrievalCapabilities,
  searchVideoKnowledge,
} from '../../../packages/core/src/video-knowledge/retrieval';
import { verifyMediaEvidence } from '../../../packages/core/src/video-knowledge/verification';
import { confidenceWithCoverage } from '../../../packages/core/src/video-knowledge/confidence';
import { deleteVideoKnowledgeForMediaAsset } from '../../../packages/core/src/video-knowledge/deletion-store';

const repoRoot = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');

/* ------------------------------------------------------------------ */
/*  Evaluation scoring                                                 */
/* ------------------------------------------------------------------ */

test.describe('Video Knowledge evaluation and safety policy', () => {
  test('scores timestamped source coverage and does not promote unsupported claims', () => {
    const result = scoreVideoKnowledgeEvaluation(
      {
        id: 'score-change',
        expectedEvidenceRanges: [{ startSecs: 10, endSecs: 12, precision: 'frame' }],
        expectedClaimSupported: true,
        expectedTimestampSecs: 11,
      },
      {
        ranges: [{ startSecs: 10.5, endSecs: 11.5, precision: 'frame' }],
        claimSupported: true,
        timestampSecs: 11.25,
      },
    );
    expect(result).toEqual({ coverage: 1, timestampErrorSecs: 0.25, supportedClaimPrecision: 1 });
  });

  test('hands oversized or exhausted work to background refinement instead of unbounded inspection', () => {
    const decision = decideInspection({
      required: true,
      plausibleRange: true,
      estimate: {
        durationSecs: 31,
        bytes: 1,
        sandboxSeconds: 1,
        spendUsd: 0,
        lowerResolutionProbability: 1,
      },
      budget: {
        remainingDurationSecs: 180,
        remainingBytes: 1024 * 1024 * 1024,
        remainingSandboxSeconds: 600,
        remainingSpendUsd: 0.5,
        usedBundleRuns: 0,
      },
    });
    expect(decision.decision).toBe('background-refinement');
  });
});

/* ------------------------------------------------------------------ */
/*  Evaluation corpus expansion                                        */
/* ------------------------------------------------------------------ */

test.describe('Evaluation scoring — extended corpus', () => {
  test('coverage is 0 when actual ranges miss the expected ranges entirely', () => {
    const result = scoreVideoKnowledgeEvaluation(
      {
        id: 'no-overlap',
        expectedEvidenceRanges: [{ startSecs: 0, endSecs: 10, precision: 'frame' }],
        expectedClaimSupported: true,
      },
      {
        ranges: [{ startSecs: 20, endSecs: 30, precision: 'frame' }],
        claimSupported: true,
      },
    );
    expect(result.coverage).toBe(0);
    expect(result.supportedClaimPrecision).toBe(1); // claim match is separate
    expect(result.timestampErrorSecs).toBeUndefined();
  });

  test('coverage handles multiple expected ranges with partial matches', () => {
    const result = scoreVideoKnowledgeEvaluation(
      {
        id: 'partial-match',
        expectedEvidenceRanges: [
          { startSecs: 0, endSecs: 10, precision: 'frame' },
          { startSecs: 20, endSecs: 30, precision: 'frame' },
          { startSecs: 40, endSecs: 50, precision: 'frame' },
        ],
        expectedClaimSupported: true,
      },
      {
        ranges: [
          { startSecs: 5, endSecs: 15, precision: 'frame' }, // overlaps first
          { startSecs: 35, endSecs: 45, precision: 'frame' }, // overlaps third
        ],
        claimSupported: true,
      },
    );
    // 2 out of 3 expected ranges have overlapping actual ranges.
    expect(result.coverage).toBeCloseTo(2 / 3);
  });

  test('coverage is 1 when no expected ranges are defined', () => {
    const result = scoreVideoKnowledgeEvaluation(
      { id: 'empty-expected', expectedEvidenceRanges: [], expectedClaimSupported: false },
      { ranges: [{ startSecs: 0, endSecs: 10, precision: 'segment' }], claimSupported: false },
    );
    expect(result.coverage).toBe(1);
  });

  test('unsupported claim mismatch yields precision 0', () => {
    const result = scoreVideoKnowledgeEvaluation(
      { id: 'mismatch', expectedEvidenceRanges: [], expectedClaimSupported: true },
      { ranges: [], claimSupported: false },
    );
    expect(result.supportedClaimPrecision).toBe(0);
  });

  test('timestamp error is computed correctly for different precision levels', () => {
    const frameResult = scoreVideoKnowledgeEvaluation(
      {
        id: 'frame',
        expectedEvidenceRanges: [{ startSecs: 10, endSecs: 10.5, precision: 'frame' }],
        expectedClaimSupported: true,
        expectedTimestampSecs: 10.25,
      },
      {
        ranges: [{ startSecs: 10, endSecs: 10.5, precision: 'frame' }],
        claimSupported: true,
        timestampSecs: 10.3,
      },
    );
    expect(frameResult.timestampErrorSecs).toBeCloseTo(0.05);

    const wordResult = scoreVideoKnowledgeEvaluation(
      {
        id: 'word',
        expectedEvidenceRanges: [{ startSecs: 5, endSecs: 8, precision: 'word' }],
        expectedClaimSupported: true,
        expectedTimestampSecs: 6.5,
      },
      {
        ranges: [{ startSecs: 5, endSecs: 8, precision: 'word' }],
        claimSupported: true,
        timestampSecs: 7.0,
      },
    );
    expect(wordResult.timestampErrorSecs).toBeCloseTo(0.5);
  });
});

/* ------------------------------------------------------------------ */
/*  Query planner classification                                       */
/* ------------------------------------------------------------------ */

test.describe('Query planner — question kind classification', () => {
  test('classifies direct speech questions', () => {
    const plan = planVideoQuestion('What did the speaker say about the budget?');
    expect(plan.kinds).toContain('direct-speech');
    expect(plan.modalities).toContain('transcript');
  });

  test('classifies exact OCR questions', () => {
    const plan = planVideoQuestion('What text is shown on the screen?');
    expect(plan.kinds).toContain('exact-ocr');
    expect(plan.modalities).toContain('ocr');
  });

  test('classifies state-change questions and requires both ranges', () => {
    const plan = planVideoQuestion(
      'How did the displayed value change between the first and second section?',
    );
    expect(plan.kinds).toContain('state-change');
    expect(plan.requiresBothRanges).toBe(true);
  });

  test('classifies comparison questions and requires both ranges', () => {
    const plan = planVideoQuestion('Compare the two alternatives.');
    expect(plan.kinds).toContain('comparison');
    expect(plan.requiresBothRanges).toBe(true);
  });

  test('classifies outcome questions', () => {
    const plan = planVideoQuestion('What was the final result?');
    expect(plan.kinds).toContain('outcome');
    expect(plan.modalities).toContain('visual');
    expect(plan.modalities).toContain('transcript');
  });

  test('uses language-neutral cross-modal retrieval for an unclassified question', () => {
    const plan = planVideoQuestion('この動画では何が起きましたか？');
    expect(plan.kinds).toContain('visual-fact');
    expect(plan.modalities).toEqual(
      expect.arrayContaining(['transcript', 'ocr', 'visual', 'computed']),
    );
    expect(plan.requiresInspectionWhenInsufficient).toBe(true);
  });

  test('classifies counting questions', () => {
    const plan = planVideoQuestion('How many items appeared?');
    expect(plan.kinds).toContain('counting');
    expect(plan.requiresInspectionWhenInsufficient).toBe(true);
  });

  test('classifies computation questions', () => {
    const plan = planVideoQuestion('Calculate the average value per section.');
    expect(plan.kinds).toContain('computation');
    expect(plan.modalities).toContain('computed');
  });

  test('defaults to visual-fact for generic questions', () => {
    const plan = planVideoQuestion('What is happening in this video?');
    expect(plan.kinds).toContain('visual-fact');
    expect(plan.modalities).toContain('visual');
  });
});

/* ------------------------------------------------------------------ */
/*  Retrieval capabilities and search                                  */
/* ------------------------------------------------------------------ */

test.describe('Retrieval capabilities and search', () => {
  test('reports accurate capability declaration', () => {
    const caps = videoKnowledgeRetrievalCapabilities();
    expect(caps.lexical).toBe(true);
    expect(caps.semantic).toBe(true);
    expect(caps.hybrid).toBe(true);
    expect(caps.metadataFiltering).toBe(true);
    expect(caps.deleteByDocument).toBe(false);
  });

  test('retrieval returns conflict flag for conflicted evidence', async () => {
    const { appendEvidence } = await import(
      `${repoRoot}/packages/core/src/video-knowledge/evidence-store`
    );
    const { createVideoKnowledgeRevision } = await import(
      `${repoRoot}/packages/core/src/video-knowledge/revision-store`
    );
    const { activateVideoKnowledgeManifest } = await import(
      `${repoRoot}/packages/core/src/video-knowledge/manifest-store`
    );
    const { recordVideoKnowledgeConflict } = await import(
      `${repoRoot}/packages/core/src/video-knowledge/conflict-store`
    );

    const mediaAssetId = randomUUID();
    const revision = await createVideoKnowledgeRevision({
      mediaAssetId,
      sourceFingerprint: 'retrieval-test-fp',
      pipelineVersion: 'test-v1',
      budget: {
        maxDurationSecs: 60,
        maxBytes: 1024,
        maxFrames: 10,
        maxModelCalls: 1,
        maxCostUsd: 0,
      },
      coverage: {
        sourceDurationSecs: 60,
        inspectedRanges: [],
        transcriptCoverage: 1,
        visualCoverage: 0,
        ocrCoverage: 0,
        partialReasons: [],
      },
    });

    const evidence = await appendEvidence({
      mediaAssetId,
      knowledgeRevisionId: revision.id,
      modality: 'transcript',
      timeRange: { startSecs: 0, endSecs: 30, precision: 'word' },
      payload: 'The winner is Team Alpha.',
      source: { kind: 'provider', provider: 'deepgram' },
      confidence: {
        score: 0.9,
        source: 'provider',
        calibrationStatus: 'uncalibrated',
        uncertaintyReasons: [],
      },
    });

    await activateVideoKnowledgeManifest({
      mediaAssetId,
      knowledgeRevisionId: revision.id,
      activeEvidenceRevisionIds: { [evidence.lineageId]: evidence.id },
      activeObservationRevisionIds: {},
      activeProjectionIds: [],
      activationReason: 'initial',
    });

    // Without conflict → conflict should be false.
    const cleanHits = await searchVideoKnowledge(mediaAssetId, 'winner');
    expect(cleanHits.length).toBeGreaterThan(0);
    expect(cleanHits[0].conflict).toBe(false);

    // Add a conflict.
    await recordVideoKnowledgeConflict({
      mediaAssetId,
      knowledgeRevisionId: revision.id,
      evidenceLineageIds: [evidence.lineageId],
      affectedObservationLineageIds: [],
    });

    // With conflict → conflict should be true.
    const conflictedHits = await searchVideoKnowledge(mediaAssetId, 'winner');
    expect(conflictedHits.length).toBeGreaterThan(0);
    expect(conflictedHits[0].conflict).toBe(true);
  });

  test('diversifies results by minimumRangeDistanceSecs', async () => {
    const { appendEvidence } = await import(
      `${repoRoot}/packages/core/src/video-knowledge/evidence-store`
    );
    const { createVideoKnowledgeRevision } = await import(
      `${repoRoot}/packages/core/src/video-knowledge/revision-store`
    );
    const { activateVideoKnowledgeManifest } = await import(
      `${repoRoot}/packages/core/src/video-knowledge/manifest-store`
    );

    const mediaAssetId = randomUUID();
    const revision = await createVideoKnowledgeRevision({
      mediaAssetId,
      sourceFingerprint: 'diversity-test-fp',
      pipelineVersion: 'test-v1',
      budget: {
        maxDurationSecs: 120,
        maxBytes: 1024,
        maxFrames: 10,
        maxModelCalls: 1,
        maxCostUsd: 0,
      },
      coverage: {
        sourceDurationSecs: 120,
        inspectedRanges: [],
        transcriptCoverage: 1,
        visualCoverage: 0,
        ocrCoverage: 0,
        partialReasons: [],
      },
    });

    const evidenceRevisionIds: Record<string, string> = {};
    // Create 3 evidence records well-spaced (at 0s, 30s, 60s).
    for (let i = 0; i < 3; i++) {
      const startSecs = i * 30;
      const e = await appendEvidence({
        mediaAssetId,
        knowledgeRevisionId: revision.id,
        modality: 'transcript',
        timeRange: { startSecs, endSecs: startSecs + 10, precision: 'word' },
        payload: `Goal scored at minute ${i}`,
        source: { kind: 'provider', provider: 'deepgram' },
        confidence: {
          score: 0.9,
          source: 'provider',
          calibrationStatus: 'uncalibrated',
          uncertaintyReasons: [],
        },
      });
      evidenceRevisionIds[e.lineageId] = e.id;
    }

    await activateVideoKnowledgeManifest({
      mediaAssetId,
      knowledgeRevisionId: revision.id,
      activeEvidenceRevisionIds: evidenceRevisionIds,
      activeObservationRevisionIds: {},
      activeProjectionIds: [],
      activationReason: 'initial',
    });

    // With minimumRangeDistanceSecs=0 (disable dedup) → all 3 should be returned.
    const allHits = await searchVideoKnowledge(mediaAssetId, 'goal scored', 10, {
      minimumRangeDistanceSecs: 0,
    });
    expect(allHits.length).toBe(3);

    // With 40-second distance → only 2 should be returned (0s and 60s; 30s is within 40s of 0s).
    const diverseHits = await searchVideoKnowledge(mediaAssetId, 'goal scored', 10, {
      minimumRangeDistanceSecs: 40,
    });
    expect(diverseHits.length).toBe(2);
  });

  test('returns empty results for an asset without an active manifest', async () => {
    const hits = await searchVideoKnowledge(randomUUID(), 'anything');
    expect(hits).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/*  Verification gate                                                  */
/* ------------------------------------------------------------------ */

test.describe('Verification gate — frame precision enforcement', () => {
  test('returns needs_inspection for segment-precision evidence when frame precision is required', async () => {
    const { appendEvidence } = await import(
      `${repoRoot}/packages/core/src/video-knowledge/evidence-store`
    );
    const { createVideoKnowledgeRevision } = await import(
      `${repoRoot}/packages/core/src/video-knowledge/revision-store`
    );
    const { activateVideoKnowledgeManifest } = await import(
      `${repoRoot}/packages/core/src/video-knowledge/manifest-store`
    );

    const mediaAssetId = randomUUID();
    const revision = await createVideoKnowledgeRevision({
      mediaAssetId,
      sourceFingerprint: 'verify-precision-fp',
      pipelineVersion: 'test-v1',
      budget: {
        maxDurationSecs: 60,
        maxBytes: 1024,
        maxFrames: 10,
        maxModelCalls: 1,
        maxCostUsd: 0,
      },
      coverage: {
        sourceDurationSecs: 60,
        inspectedRanges: [],
        transcriptCoverage: 1,
        visualCoverage: 0,
        ocrCoverage: 0,
        partialReasons: [],
      },
    });

    const evidence = await appendEvidence({
      mediaAssetId,
      knowledgeRevisionId: revision.id,
      modality: 'transcript',
      timeRange: { startSecs: 10, endSecs: 20, precision: 'segment' },
      payload: 'Evidence with segment precision.',
      source: { kind: 'provider', provider: 'deepgram' },
      confidence: {
        score: 0.9,
        source: 'provider',
        calibrationStatus: 'uncalibrated',
        uncertaintyReasons: [],
      },
    });

    await activateVideoKnowledgeManifest({
      mediaAssetId,
      knowledgeRevisionId: revision.id,
      activeEvidenceRevisionIds: { [evidence.lineageId]: evidence.id },
      activeObservationRevisionIds: {},
      activeProjectionIds: [],
      activationReason: 'initial',
    });

    // Without frame precision requirement → should be supported.
    const supported = await verifyMediaEvidence({
      mediaAssetId,
      evidenceIds: [evidence.id],
    });
    expect(supported.status).toBe('supported');

    // With frame precision requirement → should need inspection.
    const needsInspection = await verifyMediaEvidence({
      mediaAssetId,
      evidenceIds: [evidence.id],
      requiresFramePrecision: true,
    });
    expect(needsInspection.status).toBe('needs_inspection');
    expect(needsInspection.reasons[0]).toContain('bounded source inspection');
  });
});

/* ------------------------------------------------------------------ */
/*  Confidence scoring                                                 */
/* ------------------------------------------------------------------ */

test.describe('Confidence — coverage-linked scoring', () => {
  test('uncalibrated analysis is capped at 0.7 and includes reason', () => {
    const confidence = confidenceWithCoverage({
      score: 0.95,
      source: 'provider',
      calibrationStatus: 'uncalibrated',
      coverage: 0.8,
    });
    expect(confidence.score).toBe(0.7); // Capped
    expect(confidence.coverage).toBe(0.8);
    expect(confidence.uncertaintyReasons).toContain(
      'Analysis is uncalibrated against the evaluation corpus.',
    );
    expect(confidence.uncertaintyReasons).toContain('Only 80% of the relevant range is covered.');
  });

  test('calibrated analysis preserves the original score', () => {
    const confidence = confidenceWithCoverage({
      score: 0.95,
      source: 'provider',
      calibrationStatus: 'calibrated',
      coverage: 1,
    });
    expect(confidence.score).toBe(0.95);
    expect(confidence.uncertaintyReasons).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  Deletion / Retention                                               */
/* ------------------------------------------------------------------ */

test.describe('Video knowledge deletion and retention', () => {
  test('deletion cascades across all 18 store arrays for a given mediaAssetId', async () => {
    const {
      appendEvidence,
      appendObservation,
      appendState,
      appendStateTransition,
      appendEvent,
      appendScene,
      appendFrameArtifact,
      appendEvidenceConflict,
    } = await import(`${repoRoot}/packages/core/src/video-knowledge/evidence-store`);
    const { createVideoKnowledgeRevision } = await import(
      `${repoRoot}/packages/core/src/video-knowledge/revision-store`
    );
    const { createVideoKnowledgeJob } = await import(
      `${repoRoot}/packages/core/src/video-knowledge/job-store`
    );
    const { activateVideoKnowledgeManifest, saveVideoKnowledgeProjection } = await import(
      `${repoRoot}/packages/core/src/video-knowledge/manifest-store`
    );
    const { reserveInspectionBudget, createBackgroundRefinement } = await import(
      `${repoRoot}/packages/core/src/video-knowledge/inspection-store`
    );
    const { readVideoKnowledgeState } = await import(
      `${repoRoot}/packages/core/src/video-knowledge/store`
    );

    const mediaAssetId = randomUUID();
    const confidence = {
      score: 0.9,
      source: 'provider' as const,
      calibrationStatus: 'uncalibrated' as const,
      uncertaintyReasons: [],
    };
    const timeRange = { startSecs: 0, endSecs: 60, precision: 'segment' as const };

    // Create records in all 18 arrays.
    const revision = await createVideoKnowledgeRevision({
      mediaAssetId,
      sourceFingerprint: 'del-test',
      pipelineVersion: 'v1',
      budget: {
        maxDurationSecs: 60,
        maxBytes: 1024,
        maxFrames: 10,
        maxModelCalls: 1,
        maxCostUsd: 0,
      },
      coverage: {
        sourceDurationSecs: 60,
        inspectedRanges: [],
        transcriptCoverage: 0,
        visualCoverage: 0,
        ocrCoverage: 0,
        partialReasons: [],
      },
    });
    await createVideoKnowledgeJob({
      mediaAssetId,
      knowledgeRevisionId: revision.id,
      idempotencyKey: randomUUID(),
      budget: revision.budget,
    });
    await appendFrameArtifact({
      mediaAssetId,
      knowledgeRevisionId: revision.id,
      storageRef: 'ref',
      timestampSecs: 0,
      width: 100,
      height: 100,
      candidateSignals: {},
      selectionDecision: 'retained',
      selectionReason: 'test',
    });
    const ev = await appendEvidence({
      mediaAssetId,
      knowledgeRevisionId: revision.id,
      modality: 'transcript',
      timeRange,
      payload: 'text',
      source: { kind: 'provider' },
      confidence,
    });
    await appendObservation({
      mediaAssetId,
      knowledgeRevisionId: revision.id,
      kind: 'speech',
      timeRange,
      value: 'obs',
      evidenceLineageIds: [ev.lineageId],
      confidence,
    });
    await appendState({
      mediaAssetId,
      knowledgeRevisionId: revision.id,
      subject: 's',
      property: 'p',
      value: 'v',
      timeRange,
      evidenceLineageIds: [ev.lineageId],
      confidence,
    });
    await appendStateTransition({
      mediaAssetId,
      knowledgeRevisionId: revision.id,
      afterStateId: 'x',
      description: 'd',
      timeRange,
      evidenceLineageIds: [ev.lineageId],
      confidence,
    });
    await appendEvent({
      mediaAssetId,
      knowledgeRevisionId: revision.id,
      type: 'goal',
      description: 'desc',
      timeRange,
      evidenceLineageIds: [ev.lineageId],
      observationLineageIds: [],
      transitionLineageIds: [],
      confidence,
    });
    await appendScene({
      mediaAssetId,
      knowledgeRevisionId: revision.id,
      title: 'scene',
      timeRange,
      eventLineageIds: [],
      evidenceLineageIds: [ev.lineageId],
      quality: confidence,
      capabilities: [],
    });
    await appendEvidenceConflict({
      mediaAssetId,
      knowledgeRevisionId: revision.id,
      evidenceLineageIds: [ev.lineageId],
      affectedObservationLineageIds: [],
      status: 'conflicted',
    });
    const proj = await saveVideoKnowledgeProjection({
      mediaAssetId,
      knowledgeRevisionId: revision.id,
      kind: 'transcript',
      lineageIds: [],
      evidenceIds: [],
      active: true,
      quality: confidence,
    });
    await activateVideoKnowledgeManifest({
      mediaAssetId,
      knowledgeRevisionId: revision.id,
      activeEvidenceRevisionIds: {},
      activeObservationRevisionIds: {},
      activeProjectionIds: [proj.id],
      activationReason: 'initial',
    });
    await reserveInspectionBudget({
      mediaAssetId,
      queryId: randomUUID(),
      purpose: 'test',
      durationSecs: 1,
      bytes: 1,
      sandboxSeconds: 1,
      spendUsd: 0,
    });
    await createBackgroundRefinement({
      mediaAssetId,
      parentRevisionId: revision.id,
      queryId: randomUUID(),
      coveragePlan: [],
      estimate: { maxDurationSecs: 1, maxBytes: 1, maxCostUsd: 0 },
    });
    const { saveCachedArtifactAnalysis } = await import(
      `${repoRoot}/packages/core/src/video-knowledge/artifact-cache-store`
    );
    await saveCachedArtifactAnalysis({
      key: randomUUID(),
      mediaAssetId,
      knowledgeRevisionId: revision.id,
      operation: 'ocr',
      value: { blocks: [] },
    });

    // Also populate summaries, chapters, derived (via knowledge builder or directly).
    const { mutateVideoKnowledgeState } = await import(
      `${repoRoot}/packages/core/src/video-knowledge/store`
    );
    await mutateVideoKnowledgeState((state: any) => {
      state.chapters.push({
        id: randomUUID(),
        lineageId: randomUUID(),
        mediaAssetId,
        knowledgeRevisionId: revision.id,
        title: 'ch',
        timeRange,
        sceneLineageIds: [],
        eventLineageIds: [],
        evidenceLineageIds: [],
        quality: confidence,
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
      });
      state.summaries.push({
        id: randomUUID(),
        lineageId: randomUUID(),
        mediaAssetId,
        knowledgeRevisionId: revision.id,
        summary: 's',
        evidenceLineageIds: [],
        confidence,
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
      });
      state.derived.push({
        id: randomUUID(),
        lineageId: randomUUID(),
        mediaAssetId,
        knowledgeRevisionId: revision.id,
        kind: 'entity',
        value: 'v',
        inputEvidenceLineageIds: [],
        source: { kind: 'heuristic' },
        confidence,
        limitations: [],
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
      });
    });

    // Verify records exist.
    const stateBefore = await readVideoKnowledgeState();
    const hasRecords = (state: any) => {
      const keys = [
        'revisions',
        'jobs',
        'artifacts',
        'evidence',
        'observations',
        'states',
        'transitions',
        'events',
        'scenes',
        'chapters',
        'summaries',
        'derived',
        'conflicts',
        'manifests',
        'projections',
        'inspectionReservations',
        'backgroundRefinements',
        'artifactAnalysisCache',
      ];
      return keys.every((key) => state[key].some((r: any) => r.mediaAssetId === mediaAssetId));
    };
    expect(hasRecords(stateBefore)).toBe(true);

    // Delete everything for this asset.
    const deletionStats = await deleteVideoKnowledgeForMediaAsset(mediaAssetId);
    expect(typeof deletionStats).toBe('object');

    // Verify all records for this asset are gone.
    const stateAfter = await readVideoKnowledgeState();
    expect(hasRecords(stateAfter)).toBe(false);
  });

  test('deletion of one asset does not affect another asset', async () => {
    const { appendEvidence } = await import(
      `${repoRoot}/packages/core/src/video-knowledge/evidence-store`
    );
    const { createVideoKnowledgeRevision } = await import(
      `${repoRoot}/packages/core/src/video-knowledge/revision-store`
    );
    const { readVideoKnowledgeState } = await import(
      `${repoRoot}/packages/core/src/video-knowledge/store`
    );

    const assetA = randomUUID();
    const assetB = randomUUID();
    const confidence = {
      score: 0.9,
      source: 'provider' as const,
      calibrationStatus: 'uncalibrated' as const,
      uncertaintyReasons: [],
    };

    const revA = await createVideoKnowledgeRevision({
      mediaAssetId: assetA,
      sourceFingerprint: 'a',
      pipelineVersion: 'v1',
      budget: {
        maxDurationSecs: 60,
        maxBytes: 1024,
        maxFrames: 10,
        maxModelCalls: 1,
        maxCostUsd: 0,
      },
      coverage: {
        sourceDurationSecs: 60,
        inspectedRanges: [],
        transcriptCoverage: 0,
        visualCoverage: 0,
        ocrCoverage: 0,
        partialReasons: [],
      },
    });
    const revB = await createVideoKnowledgeRevision({
      mediaAssetId: assetB,
      sourceFingerprint: 'b',
      pipelineVersion: 'v1',
      budget: {
        maxDurationSecs: 60,
        maxBytes: 1024,
        maxFrames: 10,
        maxModelCalls: 1,
        maxCostUsd: 0,
      },
      coverage: {
        sourceDurationSecs: 60,
        inspectedRanges: [],
        transcriptCoverage: 0,
        visualCoverage: 0,
        ocrCoverage: 0,
        partialReasons: [],
      },
    });

    await appendEvidence({
      mediaAssetId: assetA,
      knowledgeRevisionId: revA.id,
      modality: 'transcript',
      timeRange: { startSecs: 0, endSecs: 30, precision: 'word' },
      payload: 'Asset A',
      source: { kind: 'provider' },
      confidence,
    });
    await appendEvidence({
      mediaAssetId: assetB,
      knowledgeRevisionId: revB.id,
      modality: 'transcript',
      timeRange: { startSecs: 0, endSecs: 30, precision: 'word' },
      payload: 'Asset B',
      source: { kind: 'provider' },
      confidence,
    });

    // Delete only asset A.
    await deleteVideoKnowledgeForMediaAsset(assetA);

    const state = await readVideoKnowledgeState();
    expect(state.revisions.some((r) => r.mediaAssetId === assetA)).toBe(false);
    expect(state.evidence.some((e) => e.mediaAssetId === assetA)).toBe(false);
    expect(state.revisions.some((r) => r.mediaAssetId === assetB)).toBe(true);
    expect(state.evidence.some((e) => e.mediaAssetId === assetB)).toBe(true);
  });
});
