import { readVideoKnowledgeState } from './store';
import type { EvidenceModality, TimeRange } from './types';

export type MediaEvidenceVerificationStatus =
  | 'supported'
  | 'conflicted'
  | 'insufficient'
  | 'needs_inspection';

export interface VerifyMediaEvidenceInput {
  mediaAssetId: string;
  evidenceIds: string[];
  modality?: EvidenceModality;
  timeRange?: TimeRange;
  /** Exact timestamp claims cannot rely on segment/estimated source ranges. */
  requiresFramePrecision?: boolean;
}

/**
 * Deterministic verification gate for citations. It deliberately does not let
 * a language model manufacture a timestamp or promote a summary into source
 * evidence.
 */
export async function verifyMediaEvidence(input: VerifyMediaEvidenceInput): Promise<{
  status: MediaEvidenceVerificationStatus;
  evidenceIds: string[];
  ranges: TimeRange[];
  reasons: string[];
}> {
  const state = await readVideoKnowledgeState();
  const manifest = state.manifests
    .filter((candidate) => candidate.mediaAssetId === input.mediaAssetId && candidate.activatedAt)
    .sort((a, b) => b.activatedAt!.localeCompare(a.activatedAt!))[0];
  if (!manifest)
    return {
      status: 'insufficient',
      evidenceIds: [],
      ranges: [],
      reasons: ['No active video knowledge revision.'],
    };
  const active = new Set(Object.values(manifest.activeEvidenceRevisionIds));
  const evidence = state.evidence.filter(
    (item) =>
      item.mediaAssetId === input.mediaAssetId &&
      active.has(item.id) &&
      input.evidenceIds.includes(item.id) &&
      (!input.modality || item.modality === input.modality) &&
      (!input.timeRange ||
        (item.timeRange.startSecs <= input.timeRange.endSecs &&
          item.timeRange.endSecs >= input.timeRange.startSecs)),
  );
  if (evidence.length === 0)
    return {
      status: 'insufficient',
      evidenceIds: [],
      ranges: [],
      reasons: ['No matching active source evidence.'],
    };
  const lineages = new Set(evidence.map((item) => item.lineageId));
  const conflicted = state.conflicts.some(
    (conflict) =>
      conflict.knowledgeRevisionId === manifest.knowledgeRevisionId &&
      conflict.status !== 'resolved' &&
      conflict.evidenceLineageIds.some((id) => lineages.has(id)),
  );
  const needsInspection = Boolean(
    input.requiresFramePrecision &&
      evidence.some(
        (item) => item.timeRange.precision !== 'frame' && item.timeRange.precision !== 'word',
      ),
  );
  return {
    status: conflicted ? 'conflicted' : needsInspection ? 'needs_inspection' : 'supported',
    evidenceIds: evidence.map((item) => item.id),
    ranges: evidence.map((item) => item.timeRange),
    reasons: conflicted
      ? ['Active evidence contains an unresolved conflict.']
      : needsInspection
      ? [
          'The active evidence is approximate; a bounded source inspection is required for an exact timestamp claim.',
        ]
      : [],
  };
}
