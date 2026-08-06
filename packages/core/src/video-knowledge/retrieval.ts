import { readVideoKnowledgeState } from './store';
import type { EvidenceModality, EvidenceRevision } from './types';
import type { VideoQueryPlan } from './query-planner';

export interface VideoKnowledgeSearchHit {
  evidence: EvidenceRevision;
  score: number;
  conflict: boolean;
  components: {
    lexical: number;
    semantic: number;
    modalityFit: number;
    quality: number;
    recency: number;
    temporal: number;
  };
}

export interface VideoKnowledgeRetrievalOptions {
  modalities?: EvidenceModality[];
  /** Diversify equivalent hits from one narrow source interval. */
  minimumRangeDistanceSecs?: number;
  /** Vector-ranked projection document IDs supplied by the serving layer. */
  semanticDocumentIds?: string[];
  /** Query plan from the planner, used for temporal boosting. */
  queryPlan?: VideoQueryPlan;
  /** Total video duration in seconds, used for temporal position scoring. */
  videoDurationSecs?: number;
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** Core joins serving-layer vector hits to immutable evidence for hybrid ranking. */
export function videoKnowledgeRetrievalCapabilities() {
  return {
    lexical: true,
    semantic: true,
    hybrid: true,
    metadataFiltering: true,
    deleteByDocument: false,
  } as const;
}

/** Deterministic hybrid retrieval; without vector projection IDs, semantic weight is zero. */
export async function searchVideoKnowledge(
  mediaAssetId: string,
  query: string,
  limit = 8,
  options: VideoKnowledgeRetrievalOptions = {},
): Promise<VideoKnowledgeSearchHit[]> {
  const state = await readVideoKnowledgeState();
  const manifest = state.manifests
    .filter((candidate) => candidate.mediaAssetId === mediaAssetId && candidate.activatedAt)
    .sort((a, b) => b.activatedAt!.localeCompare(a.activatedAt!))[0];
  if (!manifest) return [];
  const terms =
    query
      .normalize('NFKC')
      .toLocaleLowerCase()
      .match(/[\p{Letter}\p{Number}][\p{Letter}\p{Mark}\p{Number}_-]*/gu) ?? [];
  const activeIds = new Set(Object.values(manifest.activeEvidenceRevisionIds));
  const semanticDocumentIds = new Set(options.semanticDocumentIds ?? []);
  const semanticEvidenceIds = new Set(
    state.projections
      .filter(
        (projection) =>
          projection.mediaAssetId === mediaAssetId &&
          projection.knowledgeRevisionId === manifest.knowledgeRevisionId &&
          Boolean(projection.documentId) &&
          semanticDocumentIds.has(projection.documentId!),
      )
      .flatMap((projection) => projection.evidenceIds),
  );
  const conflicts = new Set(
    state.conflicts
      .filter(
        (conflict) =>
          conflict.knowledgeRevisionId === manifest.knowledgeRevisionId &&
          conflict.status !== 'resolved',
      )
      .flatMap((conflict) => conflict.evidenceLineageIds),
  );
  const revisionCreatedAt =
    state.revisions.find((revision) => revision.id === manifest.knowledgeRevisionId)?.createdAt ??
    manifest.createdAt;

  // Determine temporal boosting strategy from the query plan.
  const plan = options.queryPlan;
  const isOutcomeQuery = plan?.kinds?.includes('outcome') ?? false;
  const isStateChangeQuery = plan?.kinds?.includes('state-change') ?? false;
  const needsTemporalBoost = isOutcomeQuery || isStateChangeQuery;
  // Use the explicit duration when provided; fall back to coverage metadata.
  const videoDurationSecs =
    options.videoDurationSecs ??
    state.revisions.find((r) => r.id === manifest.knowledgeRevisionId)?.coverage
      ?.sourceDurationSecs ??
    0;

  const candidates = state.evidence
    .filter((evidence) => evidence.mediaAssetId === mediaAssetId && activeIds.has(evidence.id))
    .filter(
      (evidence) => !options.modalities?.length || options.modalities.includes(evidence.modality),
    )
    .map((evidence) => {
      const text = JSON.stringify(evidence.payload).normalize('NFKC').toLocaleLowerCase();
      const lexical =
        terms.reduce((sum, term) => sum + (text.includes(term) ? 1 : 0), 0) /
        Math.max(1, terms.length);
      const semantic = semanticEvidenceIds.has(evidence.id) ? 1 : 0;
      const modalityFit = options.modalities?.length ? 1 : 0.7;
      const quality =
        clamp(evidence.confidence.score) *
        (evidence.confidence.calibrationStatus === 'calibrated' ? 1 : 0.7);
      // Recency means index revision recency, never a later point in the same video.
      const recency = evidence.createdAt >= revisionCreatedAt ? 1 : 0.8;

      // Temporal position: how far into the video is this evidence (0→1).
      // For outcome queries, later evidence (closer to the end) scores higher
      // because final results and conclusions often appear near the end.
      let temporal = 0;
      if (needsTemporalBoost && videoDurationSecs > 0) {
        const position = clamp(evidence.timeRange.endSecs / videoDurationSecs);
        // Outcome queries strongly favor the last 30% of the video.
        // State-change queries moderately favor later evidence.
        temporal = isOutcomeQuery ? position : position * 0.6;
      }

      const score = needsTemporalBoost
        ? clamp(
            lexical * 0.25 +
              semantic * 0.15 +
              modalityFit * 0.1 +
              quality * 0.15 +
              recency * 0.1 +
              temporal * 0.25,
          )
        : clamp(
            lexical * 0.35 + semantic * 0.2 + modalityFit * 0.15 + quality * 0.2 + recency * 0.1,
          );
      return {
        evidence,
        score,
        conflict: conflicts.has(evidence.lineageId),
        components: { lexical, semantic, modalityFit, quality, recency, temporal },
      };
    })
    .filter(
      (hit) => terms.length === 0 || hit.components.lexical > 0 || hit.components.semantic > 0,
    )
    .sort(
      (a, b) =>
        b.score - a.score || a.evidence.timeRange.startSecs - b.evidence.timeRange.startSecs,
    );

  // For outcome queries, also sort by time to give the LLM a full chronological
  // progression of the matching evidence (e.g., value: draft → review → approved).
  if (isOutcomeQuery && candidates.length > 0) {
    // Take more candidates than usual, then sort chronologically so the LLM
    // can see the full state progression and identify the final value.
    const expanded = candidates.slice(0, Math.max(limit, 12));
    expanded.sort((a, b) => a.evidence.timeRange.startSecs - b.evidence.timeRange.startSecs);
    const selected: VideoKnowledgeSearchHit[] = [];
    const distance = Math.max(0, options.minimumRangeDistanceSecs ?? 2);
    for (const candidate of expanded) {
      if (
        selected.some(
          (hit) =>
            Math.abs(hit.evidence.timeRange.startSecs - candidate.evidence.timeRange.startSecs) <
              distance && hit.evidence.modality === candidate.evidence.modality,
        )
      )
        continue;
      selected.push(candidate);
      if (selected.length >= limit) break;
    }
    return selected;
  }

  const selected: VideoKnowledgeSearchHit[] = [];
  const distance = Math.max(0, options.minimumRangeDistanceSecs ?? 2);
  for (const candidate of candidates) {
    if (
      selected.some(
        (hit) =>
          Math.abs(hit.evidence.timeRange.startSecs - candidate.evidence.timeRange.startSecs) <
            distance && hit.evidence.modality === candidate.evidence.modality,
      )
    )
      continue;
    selected.push(candidate);
    if (selected.length >= limit) break;
  }
  return selected;
}
