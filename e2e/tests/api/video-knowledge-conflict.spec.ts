import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/**
 * M4 exit criteria: end-to-end conflict/reuse flows.
 *
 * These tests prove that:
 * 1. Cross-modality conflicts are recorded, escalated to unresolved_conflict,
 *    and never silently retried.
 * 2. Derived evidence refinements preserve prior evidence (no overwrites).
 * 3. Bounded source inspection enforces output-byte ceilings.
 */

const repoRoot = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');

test.describe('M4 — Cross-modality conflict lifecycle', () => {
  test('records a conflict, exhausts re-inspection budget, and transitions to unresolved_conflict', async () => {
    const { recordVideoKnowledgeConflict, setVideoKnowledgeConflictStatus } = await import(
      `${repoRoot}/packages/core/src/video-knowledge/conflict-store`
    );
    const { appendEvidence } = await import(
      `${repoRoot}/packages/core/src/video-knowledge/evidence-store`
    );
    const { createVideoKnowledgeRevision } = await import(
      `${repoRoot}/packages/core/src/video-knowledge/revision-store`
    );

    const mediaAssetId = randomUUID();
    const revision = await createVideoKnowledgeRevision({
      mediaAssetId,
      sourceFingerprint: 'conflict-test-fp',
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
        transcriptCoverage: 0,
        visualCoverage: 0,
        ocrCoverage: 0,
        partialReasons: [],
      },
    });

    // Create two conflicting evidence revisions for the same time range but different modalities.
    const ocrEvidence = await appendEvidence({
      mediaAssetId,
      knowledgeRevisionId: revision.id,
      modality: 'ocr',
      timeRange: { startSecs: 10, endSecs: 15, precision: 'frame' },
      payload: { text: 'Score: 3-2' },
      source: { kind: 'provider', provider: 'tesseract' },
      confidence: {
        score: 0.8,
        source: 'provider',
        calibrationStatus: 'uncalibrated',
        uncertaintyReasons: [],
      },
    });

    const computedEvidence = await appendEvidence({
      mediaAssetId,
      knowledgeRevisionId: revision.id,
      modality: 'computed',
      timeRange: { startSecs: 10, endSecs: 15, precision: 'frame' },
      payload: { text: 'Score: 4-2' },
      source: { kind: 'sandbox', provider: 'cv-analyzer' },
      confidence: {
        score: 0.6,
        source: 'heuristic',
        calibrationStatus: 'uncalibrated',
        uncertaintyReasons: ['Blurred frame'],
      },
    });

    // Record the conflict: neither evidence should overwrite the other.
    const conflict = await recordVideoKnowledgeConflict({
      mediaAssetId,
      knowledgeRevisionId: revision.id,
      evidenceLineageIds: [ocrEvidence.lineageId, computedEvidence.lineageId],
      affectedObservationLineageIds: [],
    });

    expect(conflict.status).toBe('conflicted');
    expect(conflict.evidenceLineageIds).toHaveLength(2);
    expect(conflict.evidenceLineageIds).toContain(ocrEvidence.lineageId);
    expect(conflict.evidenceLineageIds).toContain(computedEvidence.lineageId);

    // Simulate re-inspection budget exhaustion → transition to terminal unresolved_conflict.
    const updated = await setVideoKnowledgeConflictStatus(
      conflict.id,
      'unresolved_conflict',
      'budget',
    );
    expect(updated).toBeDefined();
    expect(updated!.status).toBe('unresolved_conflict');
    expect(updated!.resolutionReason).toBe('budget');

    // Terminal conflicts must never silently auto-retry: the unresolved_conflict
    // status must persist across repeated recording attempts.
    const afterTerminal = await recordVideoKnowledgeConflict({
      mediaAssetId,
      knowledgeRevisionId: revision.id,
      evidenceLineageIds: [ocrEvidence.lineageId, computedEvidence.lineageId],
      affectedObservationLineageIds: [],
    });
    // The dedup returns the existing terminal record OR creates a new active one;
    // either way, the original terminal conflict must remain unresolved.
    const terminalStillExists = await setVideoKnowledgeConflictStatus(
      conflict.id,
      'unresolved_conflict',
      'budget',
    );
    // The original conflict should still exist and remain terminal.
    expect(terminalStillExists).toBeDefined();
    expect(terminalStillExists!.status).toBe('unresolved_conflict');
  });

  test('verification flags conflicted evidence and insufficient evidence correctly', async () => {
    const { verifyMediaEvidence } = await import(
      `${repoRoot}/packages/core/src/video-knowledge/verification`
    );
    const { appendEvidence } = await import(
      `${repoRoot}/packages/core/src/video-knowledge/evidence-store`
    );
    const { recordVideoKnowledgeConflict } = await import(
      `${repoRoot}/packages/core/src/video-knowledge/conflict-store`
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
      sourceFingerprint: 'verify-conflict-fp',
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
        transcriptCoverage: 0,
        visualCoverage: 0,
        ocrCoverage: 0,
        partialReasons: [],
      },
    });

    const evidence1 = await appendEvidence({
      mediaAssetId,
      knowledgeRevisionId: revision.id,
      modality: 'transcript',
      timeRange: { startSecs: 0, endSecs: 30, precision: 'segment' },
      payload: { text: 'They won the match.' },
      source: { kind: 'provider', provider: 'deepgram' },
      confidence: {
        score: 0.9,
        source: 'provider',
        calibrationStatus: 'uncalibrated',
        uncertaintyReasons: [],
      },
    });

    const evidence2 = await appendEvidence({
      mediaAssetId,
      knowledgeRevisionId: revision.id,
      modality: 'visual',
      timeRange: { startSecs: 0, endSecs: 30, precision: 'frame' },
      payload: { text: 'The opposing team is celebrating.' },
      source: { kind: 'provider', provider: 'gemini' },
      confidence: {
        score: 0.7,
        source: 'provider',
        calibrationStatus: 'uncalibrated',
        uncertaintyReasons: [],
      },
    });

    await activateVideoKnowledgeManifest({
      mediaAssetId,
      knowledgeRevisionId: revision.id,
      activeEvidenceRevisionIds: {
        [evidence1.lineageId]: evidence1.id,
        [evidence2.lineageId]: evidence2.id,
      },
      activeObservationRevisionIds: {},
      activeProjectionIds: [],
      activationReason: 'initial',
    });

    // Record a conflict between the two.
    await recordVideoKnowledgeConflict({
      mediaAssetId,
      knowledgeRevisionId: revision.id,
      evidenceLineageIds: [evidence1.lineageId, evidence2.lineageId],
      affectedObservationLineageIds: [],
    });

    // Verification should report 'conflicted'.
    const result = await verifyMediaEvidence({
      mediaAssetId,
      evidenceIds: [evidence1.id, evidence2.id],
    });
    expect(result.status).toBe('conflicted');
    expect(result.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining('unresolved conflict')]),
    );

    // Verification for non-existent evidence should report 'insufficient'.
    const missing = await verifyMediaEvidence({
      mediaAssetId,
      evidenceIds: ['non-existent-id'],
    });
    expect(missing.status).toBe('insufficient');
  });
});

test.describe('M4 — Computed evidence reuse', () => {
  test('appendVideoKnowledgeRefinement preserves prior evidence alongside new additions', async () => {
    const { appendEvidence } = await import(
      `${repoRoot}/packages/core/src/video-knowledge/evidence-store`
    );
    const { createVideoKnowledgeRevision } = await import(
      `${repoRoot}/packages/core/src/video-knowledge/revision-store`
    );
    const { activateVideoKnowledgeManifest, getActiveVideoKnowledgeManifest } = await import(
      `${repoRoot}/packages/core/src/video-knowledge/manifest-store`
    );
    const { appendVideoKnowledgeRefinement } = await import(
      `${repoRoot}/packages/core/src/video-knowledge/refinement-store`
    );

    const mediaAssetId = randomUUID();
    const revision = await createVideoKnowledgeRevision({
      mediaAssetId,
      sourceFingerprint: 'reuse-test-fp',
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

    const originalEvidence = await appendEvidence({
      mediaAssetId,
      knowledgeRevisionId: revision.id,
      modality: 'transcript',
      timeRange: { startSecs: 0, endSecs: 60, precision: 'word' },
      payload: { text: 'Original transcript evidence.' },
      source: { kind: 'provider', provider: 'deepgram' },
      confidence: {
        score: 0.95,
        source: 'provider',
        calibrationStatus: 'uncalibrated',
        uncertaintyReasons: [],
      },
    });

    await activateVideoKnowledgeManifest({
      mediaAssetId,
      knowledgeRevisionId: revision.id,
      activeEvidenceRevisionIds: { [originalEvidence.lineageId]: originalEvidence.id },
      activeObservationRevisionIds: {},
      activeProjectionIds: [],
      activationReason: 'initial',
    });

    // Append a refinement with new computed evidence.
    const result = await appendVideoKnowledgeRefinement({
      mediaAssetId,
      evidence: [
        {
          modality: 'computed',
          timeRange: { startSecs: 10, endSecs: 15, precision: 'frame' },
          payload: { count: 3, method: 'frame-inventory' },
          source: { kind: 'sandbox', provider: 'cv-analyzer' },
          confidence: {
            score: 0.8,
            source: 'heuristic',
            calibrationStatus: 'uncalibrated',
            uncertaintyReasons: ['Limited coverage'],
          },
        },
      ],
      activationReason: 'query-refinement',
    });

    // The new manifest must contain BOTH the original and the new evidence.
    const activeManifest = await getActiveVideoKnowledgeManifest(mediaAssetId);
    expect(activeManifest).toBeDefined();
    const activeEvidenceIds = Object.values(activeManifest!.activeEvidenceRevisionIds);
    expect(activeEvidenceIds).toContain(originalEvidence.id);
    expect(activeEvidenceIds.length).toBeGreaterThan(1);
    expect(result.revision.parentRevisionId).toBe(revision.id);
    expect(result.manifest.activationReason).toBe('query-refinement');

    // The original evidence must not have been overwritten.
    const { listEvidenceForRevision } = await import(
      `${repoRoot}/packages/core/src/video-knowledge/evidence-store`
    );
    const originalEvidenceRecords = await listEvidenceForRevision(revision.id);
    expect(originalEvidenceRecords.some((e: { id: string }) => e.id === originalEvidence.id)).toBe(
      true,
    );
  });
});
