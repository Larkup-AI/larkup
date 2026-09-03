import { readVideoKnowledgeState } from './store';
import type { EvidenceModality, EvidenceRevision } from './types';
import type { VideoQueryPlan } from './query-planner';
import { evidenceClaimVerdict, evidenceTextForRetrieval } from './evidence-text';

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
    informativeness: number;
  };
}

export interface VideoKnowledgeRetrievalOptions {
  modalities?: EvidenceModality[];
  /** Diversify equivalent hits from one narrow source interval. */
  minimumRangeDistanceSecs?: number;
  /** Vector-ranked projection document IDs supplied by the serving layer. */
  semanticDocumentIds?: string[];
  /**
   * Evidence id -> 0..1 similarity from the evidence-granular semantic index.
   * Unlike `semanticDocumentIds` (a chapter-sized document matched or not),
   * this is a graded score for the individual reading, and it is what makes a
   * question asked in one language rank evidence recorded in another.
   */
  semanticScores?: Map<string, number>;
  /** Query plan from the planner, used for temporal boosting. */
  queryPlan?: VideoQueryPlan;
  /** Total video duration in seconds, used for temporal position scoring. */
  videoDurationSecs?: number;
  /** Restrict retrieval to a verified source interval, such as the ending. */
  timeRange?: { startSecs: number; endSecs: number };
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** The human-readable part of a payload, for measuring how much it says. */
function readableTextOf(payload: unknown): string {
  return evidenceTextForRetrieval(payload);
}

function isStructuredState(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const text = (value as { text?: unknown }).text;
  return (
    Boolean(text) &&
    typeof text === 'object' &&
    !Array.isArray(text) &&
    typeof (text as { subject?: unknown }).subject === 'string' &&
    typeof (text as { property?: unknown }).property === 'string' &&
    'value' in (text as Record<string, unknown>)
  );
}

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
          // A query refinement publishes a new manifest while deliberately
          // retaining the parent revision's projections. The manifest is the
          // source of truth for what is active; filtering by the refinement's
          // revision id silently disconnected all of those valid vectors.
          manifest.activeProjectionIds.includes(projection.id) &&
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

  // A question about how something concluded is answered later in a source
  // than a question about what it contains, whatever the source is. That is
  // the only temporal prior applied, and it never overrides relevance.
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

  // Either the whole pass is ranked semantically or none of it is: mixing the
  // two weightings would compare scores computed on different scales.
  const hasGradedSemantics = Boolean(options.semanticScores);

  const scored = state.evidence
    .filter((evidence) => evidence.mediaAssetId === mediaAssetId && activeIds.has(evidence.id))
    .filter((evidence) => {
      const range = options.timeRange;
      return (
        !range ||
        (evidence.timeRange.startSecs <= range.endSecs &&
          evidence.timeRange.endSecs >= range.startSecs)
      );
    })
    .filter(
      (evidence) => !options.modalities?.length || options.modalities.includes(evidence.modality),
    )
    .map((evidence) => {
      const text = evidenceTextForRetrieval(evidence.payload).normalize('NFKC').toLocaleLowerCase();
      const lexical =
        terms.reduce((sum, term) => sum + (text.includes(term) ? 1 : 0), 0) /
        Math.max(1, terms.length);
      // A graded per-evidence similarity wins when one is available; the
      // document-level match remains the fallback for an asset whose semantic
      // index could not be built (no embedding credentials, provider outage).
      const semantic = hasGradedSemantics
        ? clamp(options.semanticScores!.get(evidence.id) ?? 0)
        : semanticEvidenceIds.has(evidence.id)
        ? 1
        : 0;
      // A structured reading (an overlay's text, a typed value) is a compact,
      // well-located anchor for a question about how something changed or
      // concluded. It is a ranking nudge, never an answer on its own.
      const structuredState =
        needsTemporalBoost &&
        (isStructuredState(evidence.payload) ||
          /^(?:Reconciled|Indexed)\s+state:/i.test(readableTextOf(evidence.payload).trim()))
          ? 1
          : 0;
      const modalityFit = options.modalities?.length ? 1 : 0.7;
      // Speech recognition on conversational audio emits a stream of one- and
      // two-word fragments. Each is a legitimate record, but a fragment cannot
      // support a claim, and there are hundreds of them -- left unweighted they
      // tie on every other component and crowd descriptive readings out of the
      // result entirely. Length saturates quickly: this separates a fragment
      // from a sentence, not a long reading from a longer one.
      const informativeness = clamp(readableTextOf(evidence.payload).length / 60);
      const verdict = evidenceClaimVerdict(evidence.payload);
      const quality =
        clamp(evidence.confidence.score) *
        (evidence.confidence.calibrationStatus === 'calibrated' ? 1 : 0.7) *
        // A bounded reader saying that one range did not establish a claim is
        // useful as a limitation, not as positive answer evidence. Keep it
        // searchable at a low rank without letting the echoed request win.
        (verdict === 'not-established' ? 0.35 : 1);
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

      // Weighting follows what the query can actually be matched against. A
      // question shares wording with its source only sometimes -- and never
      // when the two are in different languages -- so once a graded semantic
      // score exists it carries the ranking and lexical overlap becomes
      // corroboration. Without one, the original lexical-led weighting stands.
      const score = needsTemporalBoost
        ? clamp(
            (hasGradedSemantics
              ? lexical * 0.13 + semantic * 0.35
              : lexical * 0.25 + semantic * 0.16) +
              informativeness * 0.13 +
              modalityFit * 0.07 +
              quality * 0.13 +
              recency * 0.05 +
              temporal * 0.09 +
              structuredState * 0.05,
          )
        : clamp(
            (hasGradedSemantics
              ? lexical * 0.15 + semantic * 0.4
              : lexical * 0.3 + semantic * 0.18) +
              informativeness * 0.15 +
              modalityFit * 0.08 +
              quality * 0.15 +
              recency * 0.07,
          );
      return {
        evidence,
        score,
        conflict: conflicts.has(evidence.lineageId),
        components: { lexical, semantic, modalityFit, quality, recency, temporal, informativeness },
      };
    });

  // Evidence that shares nothing with the question is normally noise. The
  // exception is a question about how something concluded or changed: the
  // moment that answers it can be a bare reading or a remark that repeats
  // none of the question's words. Late evidence is admitted as a fallback for
  // exactly that case, and only while nothing relevant was found there --
  // once it is, an unrelated late moment would only risk attaching the wrong
  // conclusion to the subject.
  const lateWindowStartSecs = videoDurationSecs > 0 ? videoDurationSecs * 0.67 : Infinity;
  // A semantic match below this contributes ranking signal but is not, on its
  // own, a reason to admit evidence that shares nothing with the question.
  const SEMANTIC_RELEVANCE_FLOOR = 0.05;
  const isRelevant = (hit: (typeof scored)[number]) =>
    terms.length === 0 ||
    hit.components.lexical > 0 ||
    hit.components.semantic >= (hasGradedSemantics ? SEMANTIC_RELEVANCE_FLOOR : 1) ||
    (!hasGradedSemantics && hit.components.semantic > 0);
  const relevantLateCount = needsTemporalBoost
    ? scored.filter(
        (hit) => hit.evidence.timeRange.endSecs >= lateWindowStartSecs && isRelevant(hit),
      ).length
    : 0;

  const candidates = scored
    .filter((hit) => {
      if (isRelevant(hit)) return true;
      if (!needsTemporalBoost || relevantLateCount > 0) return false;
      return hit.evidence.timeRange.endSecs >= lateWindowStartSecs;
    })
    .sort(
      (a, b) =>
        b.score - a.score || a.evidence.timeRange.startSecs - b.evidence.timeRange.startSecs,
    );

  const distance = Math.max(0, options.minimumRangeDistanceSecs ?? 2);

  // A question about change or conclusion is answered by a progression, so
  // the selected evidence is returned in the order it happened. A caller
  // asking for a single hit still gets the strongest-ranked one, not the
  // earliest item of a trail.
  if (needsTemporalBoost && candidates.length > 0 && limit > 1) {
    // Diversify while the candidates are still relevance-ranked. Repeated
    // inspections can add hundreds of equal-scoring revisions at one moment;
    // trimming or sorting first lets those copies erase later source moments.
    const diverse: typeof candidates = [];
    for (const candidate of candidates) {
      if (
        diverse.some(
          (hit) =>
            Math.abs(hit.evidence.timeRange.startSecs - candidate.evidence.timeRange.startSecs) <
              distance && hit.evidence.modality === candidate.evidence.modality,
        )
      )
        continue;
      diverse.push(candidate);
      if (diverse.length >= Math.max(limit * 4, 64)) break;
    }
    candidates.splice(
      0,
      candidates.length,
      ...diverse.sort((a, b) => a.evidence.timeRange.startSecs - b.evidence.timeRange.startSecs),
    );
  }

  const selected: VideoKnowledgeSearchHit[] = [];
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
