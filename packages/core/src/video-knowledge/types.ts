/**
 * Durable, evidence-first records for the Video Knowledge Engine.
 *
 * These types deliberately live in Core rather than the optional media tool:
 * FFmpeg/model output is an input, while revisions, evidence, retrieval, and
 * activation are product data shared by every Larkup surface.
 */

export type VideoKnowledgeStatus =
  | 'queued'
  | 'acquiring'
  | 'probing'
  | 'extracting'
  | 'transcribing'
  | 'observing'
  | 'building'
  | 'projecting'
  | 'indexing'
  | 'completed'
  | 'partially_failed'
  | 'failed'
  | 'cancelled';

export type TimestampPrecision = 'word' | 'segment' | 'frame' | 'estimated';
export type EvidenceModality =
  | 'probe'
  | 'transcript'
  | 'ocr'
  | 'visual'
  | 'audio-event'
  | 'frame-diff'
  | 'computed';
export type EvidenceResolutionStatus =
  | 'uncontested'
  | 'conflicted'
  | 'resolved'
  | 'unresolved_conflict';
export type CalibrationStatus = 'calibrated' | 'uncalibrated';
export type VideoObservationKind =
  | 'speech'
  | 'ocr'
  | 'object'
  | 'action'
  | 'ui'
  | 'chart'
  | 'relationship'
  | 'state'
  | 'audio-event'
  | 'computed';
export type MetadataValue =
  | string
  | number
  | boolean
  | null
  | MetadataValue[]
  | {
      [key: string]: MetadataValue;
    };

export interface TimeRange {
  startSecs: number;
  endSecs: number;
  precision: TimestampPrecision;
}

export interface Confidence {
  score: number;
  source: 'provider' | 'heuristic' | 'calibrated';
  calibrationStatus: CalibrationStatus;
  coverage?: number;
  uncertaintyReasons: string[];
}

export interface SourceModelRef {
  kind: 'source' | 'provider' | 'heuristic' | 'sandbox';
  provider?: string;
  model?: string;
  version?: string;
}

export interface VideoBudget {
  maxDurationSecs: number;
  maxBytes: number;
  maxFrames: number;
  maxModelCalls: number;
  maxCostUsd: number;
  usedDurationSecs?: number;
  usedBytes?: number;
  usedFrames?: number;
  usedModelCalls?: number;
  usedCostUsd?: number;
}

export interface KnowledgeCoverage {
  sourceDurationSecs: number;
  inspectedRanges: TimeRange[];
  transcriptCoverage: number;
  visualCoverage: number;
  ocrCoverage: number;
  partialReasons: string[];
}

export interface IndexingGuidance {
  text: string;
  createdAt: string;
}

export interface VideoKnowledgeRevision {
  id: string;
  mediaAssetId: string;
  parentRevisionId?: string;
  pipelineVersion: string;
  sourceFingerprint: string;
  status: VideoKnowledgeStatus;
  guidance?: IndexingGuidance;
  budget: VideoBudget;
  activeManifestId?: string;
  coverage: KnowledgeCoverage;
  schemaVersion: 1;
  createdAt: string;
  completedAt?: string;
}

export interface EvidenceRevision<T = MetadataValue> {
  id: string;
  lineageId: string;
  mediaAssetId: string;
  knowledgeRevisionId: string;
  modality: EvidenceModality;
  timeRange: TimeRange;
  frameArtifactIds?: string[];
  payload: T;
  source: SourceModelRef;
  confidence: Confidence;
  schemaVersion: 1;
  createdAt: string;
}

export interface FrameArtifactRevision {
  id: string;
  lineageId: string;
  mediaAssetId: string;
  knowledgeRevisionId: string;
  /** Opaque storage key, never a machine path exposed to users/models. */
  storageRef: string;
  timestampSecs: number;
  width: number;
  height: number;
  contentHash?: string;
  perceptualHash?: string;
  candidateSignals: Record<string, number>;
  selectionDecision: 'retained' | 'dropped' | 'protected';
  selectionReason: string;
  schemaVersion: 1;
  createdAt: string;
}

export interface ObservationRevision {
  id: string;
  lineageId: string;
  mediaAssetId: string;
  knowledgeRevisionId: string;
  kind: VideoObservationKind;
  timeRange: TimeRange;
  value: MetadataValue;
  evidenceLineageIds: string[];
  confidence: Confidence;
  schemaVersion: 1;
  createdAt: string;
}

export interface StateRevision {
  id: string;
  lineageId: string;
  mediaAssetId: string;
  knowledgeRevisionId: string;
  subject: string;
  property: string;
  value: MetadataValue;
  timeRange: TimeRange;
  previousStateId?: string;
  evidenceLineageIds: string[];
  confidence: Confidence;
  schemaVersion: 1;
  createdAt: string;
}

export interface StateTransitionRevision {
  id: string;
  lineageId: string;
  mediaAssetId: string;
  knowledgeRevisionId: string;
  beforeStateId?: string;
  afterStateId: string;
  description: string;
  timeRange: TimeRange;
  evidenceLineageIds: string[];
  confidence: Confidence;
  schemaVersion: 1;
  createdAt: string;
}

export interface EventRevision {
  id: string;
  lineageId: string;
  mediaAssetId: string;
  knowledgeRevisionId: string;
  type: string;
  description: string;
  timeRange: TimeRange;
  evidenceLineageIds: string[];
  observationLineageIds: string[];
  transitionLineageIds: string[];
  confidence: Confidence;
  schemaVersion: 1;
  createdAt: string;
}

export interface SceneRevision {
  id: string;
  lineageId: string;
  mediaAssetId: string;
  knowledgeRevisionId: string;
  title: string;
  timeRange: TimeRange;
  eventLineageIds: string[];
  evidenceLineageIds: string[];
  quality: Confidence;
  capabilities: string[];
  schemaVersion: 1;
  createdAt: string;
}

/** A navigational grouping of adjacent semantic scenes. It is never primary evidence. */
export interface ChapterRevision {
  id: string;
  lineageId: string;
  mediaAssetId: string;
  knowledgeRevisionId: string;
  title: string;
  timeRange: TimeRange;
  sceneLineageIds: string[];
  eventLineageIds: string[];
  evidenceLineageIds: string[];
  quality: Confidence;
  schemaVersion: 1;
  createdAt: string;
}

/** Evidence-linked compression for broad navigation; it cannot prove a detailed claim alone. */
export interface AssetSummaryRevision {
  id: string;
  lineageId: string;
  mediaAssetId: string;
  knowledgeRevisionId: string;
  summary: string;
  evidenceLineageIds: string[];
  confidence: Confidence;
  schemaVersion: 1;
  createdAt: string;
}

/** A reproducible calculation or normalization that remains separate from source evidence. */
export interface DerivedKnowledgeRevision {
  id: string;
  lineageId: string;
  mediaAssetId: string;
  knowledgeRevisionId: string;
  kind: 'entity' | 'relation' | 'conclusion' | 'analysis';
  value: MetadataValue;
  inputEvidenceLineageIds: string[];
  timeRange?: TimeRange;
  source: SourceModelRef;
  confidence: Confidence;
  limitations: string[];
  schemaVersion: 1;
  createdAt: string;
}

export interface EvidenceConflictRevision {
  id: string;
  mediaAssetId: string;
  knowledgeRevisionId: string;
  evidenceLineageIds: string[];
  affectedObservationLineageIds: string[];
  status: EvidenceResolutionStatus;
  resolutionReason?: 'budget' | 'policy' | 'source-unavailable' | 'no-plausible-range';
  schemaVersion: 1;
  createdAt: string;
}

export interface VideoKnowledgeProjection {
  id: string;
  mediaAssetId: string;
  knowledgeRevisionId: string;
  kind:
    | 'overview'
    | 'chapter'
    | 'scene'
    | 'event'
    | 'transcript'
    | 'ocr'
    | 'visual'
    | 'state'
    | 'computed';
  documentId?: string;
  lineageIds: string[];
  evidenceIds: string[];
  timeRange?: TimeRange;
  quality: Confidence;
  active: boolean;
  schemaVersion: 1;
  createdAt: string;
}

export interface ActiveRevisionManifest {
  id: string;
  mediaAssetId: string;
  knowledgeRevisionId: string;
  activeEvidenceRevisionIds: Record<string, string>;
  activeObservationRevisionIds: Record<string, string>;
  activeProjectionIds: string[];
  activationReason: 'initial' | 'retry' | 'model-upgrade' | 'manual-review' | 'query-refinement';
  schemaVersion: 1;
  createdAt: string;
  activatedAt?: string;
}

export interface VideoKnowledgeCheckpoint {
  stage: VideoKnowledgeStatus;
  chunkIndex?: number;
  completedEvidenceIds: string[];
  completedProjectionIds: string[];
  updatedAt: string;
}

export interface VideoKnowledgeJob {
  id: string;
  mediaAssetId: string;
  knowledgeRevisionId: string;
  status: VideoKnowledgeStatus;
  checkpoint: VideoKnowledgeCheckpoint;
  attempt: number;
  idempotencyKey: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  heartbeatAt?: string;
  cancellationRequestedAt?: string;
  retryHistory: Array<{ attempt: number; reason: string; at: string }>;
  retryAfter?: string;
  budget: VideoBudget;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InspectionBudgetReservation {
  id: string;
  mediaAssetId: string;
  queryId: string;
  purpose: string;
  durationSecs: number;
  bytes: number;
  sandboxSeconds: number;
  spendUsd: number;
  status: 'reserved' | 'released' | 'consumed';
  createdAt: string;
  releasedAt?: string;
}

export interface BackgroundRefinementJob {
  id: string;
  mediaAssetId: string;
  parentRevisionId: string;
  queryId: string;
  coveragePlan: Array<{ startSecs: number; endSecs: number; purpose: string }>;
  estimate: Pick<VideoBudget, 'maxDurationSecs' | 'maxBytes' | 'maxCostUsd'>;
  status:
    | 'awaiting_budget_approval'
    | 'queued'
    | 'running'
    | 'completed'
    | 'failed'
    | 'declined'
    | 'expired';
  expiresAt: string;
  terminalReason?: 'approval-declined' | 'approval-expired' | 'execution-failed';
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/** Durable, source-scoped result cache for expensive deterministic media analysis. */
export interface ArtifactAnalysisCacheEntry {
  key: string;
  mediaAssetId: string;
  knowledgeRevisionId: string;
  operation: string;
  value: MetadataValue;
  createdAt: string;
}

export interface VideoKnowledgeStoreState {
  schemaVersion: 1;
  revisions: VideoKnowledgeRevision[];
  jobs: VideoKnowledgeJob[];
  inspectionReservations: InspectionBudgetReservation[];
  backgroundRefinements: BackgroundRefinementJob[];
  artifactAnalysisCache: ArtifactAnalysisCacheEntry[];
  artifacts: FrameArtifactRevision[];
  evidence: EvidenceRevision[];
  observations: ObservationRevision[];
  states: StateRevision[];
  transitions: StateTransitionRevision[];
  events: EventRevision[];
  scenes: SceneRevision[];
  chapters: ChapterRevision[];
  summaries: AssetSummaryRevision[];
  derived: DerivedKnowledgeRevision[];
  conflicts: EvidenceConflictRevision[];
  manifests: ActiveRevisionManifest[];
  projections: VideoKnowledgeProjection[];
}

export const DEFAULT_VIDEO_CONFIDENCE: Confidence = {
  score: 1,
  source: 'heuristic',
  calibrationStatus: 'uncalibrated',
  uncertaintyReasons: [],
};
