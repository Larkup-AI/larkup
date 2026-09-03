/**
 * 'local' is the user-facing/config-level mode (auto-detects Docker vs.
 * native). 'local-docker' and 'local-process' remain the concrete kinds
 * runtime.ts executes against once detection resolves 'local' to one of them.
 */
export type VideoRuntimeMode =
  | 'local'
  | 'local-docker'
  | 'local-process'
  | 'managed-cloud'
  | 'custom-remote';
export type LocalVideoRuntimeKind = 'local-docker' | 'local-process';
export type VideoIndexingMode = 'fast' | 'balanced' | 'thorough';
/** Optional free-form source description; it never selects a fixed pipeline. */
export type VideoContentType = string;
export type VideoJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface VideoIndexingBrief {
  goal?: string;
  contentType: VideoContentType;
  knownEntities: string[];
  expectedQuestions: string[];
  language: string;
  importantRanges: Array<{ startSecs: number; endSecs: number; note?: string }>;
  indexingMode: VideoIndexingMode;
  /** Confirms authority or another lawful basis; it is not necessarily GDPR consent. */
  processingAuthorityConfirmed: boolean;
  retainSourceHours: number;
  /** The app supplies transcript evidence itself, so the cloud GPU skips speech decoding. */
  skipTranscription?: boolean;
  /** A bounded verification must retain its direct visual evidence source. */
  requireSemanticVision?: boolean;
  /** Reads the requested range as one chronology instead of independent clips. */
  continuousSequence?: boolean;
  /** Bounded visual budget chosen by the retrieval agent for this inspection. */
  maxFrames?: number;
}
export interface VideoSource {
  uploadId?: string;
  path?: string;
  objectKey?: string;
  url?: string;
  fileName?: string;
  mimeType?: string;
  /** Required by managed runtimes to reserve quota before a GPU worker starts. */
  durationSecs?: number;
}

export interface VideoProviderModelCredential {
  provider: string;
  apiKey: string;
  model: string;
}

/** User-owned providers required by the pipeline regardless of compute location. */
export interface VideoJobModelConfiguration {
  audio: VideoProviderModelCredential;
  brain: VideoProviderModelCredential;
  vision: VideoProviderModelCredential;
}

export interface SubmitVideoJobRequest {
  source: VideoSource;
  brief: VideoIndexingBrief;
  /** Ephemeral BYOK bundle. Cloud control planes must never persist or log it. */
  modelConfiguration?: VideoJobModelConfiguration;
  idempotencyKey?: string;
  webhookUrl?: string;
}

export interface VideoJobProgress {
  stage:
    | 'queued'
    | 'prepare'
    | 'probe'
    | 'decode'
    | 'transcribe'
    | 'ocr'
    | 'detect'
    | 'synthesize'
    | 'complete';
  /** Progress across the whole job, monotonic and smoothed by the runtime. */
  percent: number;
  message: string;
  /**
   * Progress through `stage` alone, for a host that renders one bar per step.
   * The runtime owns the mapping because only it knows how much of the job
   * each stage represents; a host that derived this itself would need a copy
   * of that budget and would silently break whenever the pipeline changed.
   */
  stagePercent?: number;
  /** Monotonic worker update id; changing this proves the pipeline is alive. */
  sequence?: number;
  elapsedSeconds?: number;
  /** Adaptive whole-worker ETA, recalibrated from measured throughput. */
  estimatedRemainingSeconds?: number;
  current?: number;
  total?: number;
  unit?: string;
}

export interface VideoUsageSummary {
  sourceMinutes: number;
  decodedFrames: number;
  retainedFrames: number;
  ocrFrames: number;
  detectorFrames: number;
  gpuSeconds: number;
}

export interface VideoJob {
  id: string;
  status: VideoJobStatus;
  createdAt: string;
  updatedAt: string;
  progress: VideoJobProgress;
  estimatedSourceMinutes: number;
  result: VideoEvidenceBundle | null;
  resultUrl?: string | null;
  error: string | null;
}

export interface TranscriptEvidence {
  startMs: number;
  endMs: number;
  text: string;
  words: Array<{ startMs: number; endMs: number; text: string; confidence: number }>;
}

export interface OcrEvidence {
  text: string;
  confidence: number;
  box: number[][];
}

export interface TrackEvidence {
  trackId: number;
  classId: number;
  label: string;
  startMs: number;
  endMs: number;
  observations: number;
  confidence: number;
}

export interface VisualObservation {
  timeMs: number;
  objects: Array<{
    label: string;
    classId: number;
    trackId: number;
    confidence: number;
    box: [number, number, number, number];
  }>;
  ocr: OcrEvidence[];
}

/**
 * Short on-screen text that stayed legible across several frames -- a title,
 * a caption, a heading, a readout. It marks where a display existed and when
 * it changed, so it is a source-navigation anchor rather than a fact.
 */
export interface RecurringOverlayText {
  text: string;
  firstSeenMs: number;
  lastSeenMs: number;
  observations: number;
  timestampsMs: number[];
  confidence: number;
}

export interface VideoEvidenceBundle {
  schemaVersion: 1;
  jobId: string;
  durationMs: number;
  video: { width: number; height: number; fps: number };
  brief: VideoIndexingBrief;
  transcript: TranscriptEvidence[];
  detectedLanguage?: string;
  visualObservations: VisualObservation[];
  tracks: TrackEvidence[];
  recurringOverlayText?: RecurringOverlayText[];
  entities: Array<{
    name: string;
    kind: 'object' | 'visible-text';
    mentions: number;
    timestampsMs?: number[];
    confidence?: number;
  }>;
  coverage: {
    requested: VideoIndexingMode;
    sourceFrames?: number;
    decodedFrames: number;
    analyzedFrames: number;
    heavyOperatorsDisabled: boolean;
    priorityRanges?: Array<{ startSecs: number; endSecs: number; reason: string }>;
    semanticClips?: number;
  };
  agentPlan?: {
    mode: VideoIndexingMode;
    summary: string;
    extractionFocus: string[];
    useTranscript: boolean;
    useOcr: boolean;
    useObjectDetection: boolean;
    useSemanticVision: boolean;
    useVideoEmbeddings: boolean;
    useSceneCuts: boolean;
    sampleIntervalSecs: number;
    prioritySampleIntervalSecs: number;
    clipWindowSecs: number;
    framesPerClip: number;
    priorityRanges: Array<{ startSecs: number; endSecs: number; reason: string }>;
    estimatedSeconds: number;
  };
  agentDiagnostics?: {
    attempted: boolean;
    provider: string;
    model: string;
    requests: number;
    latencyMs: number;
    fallback: boolean;
    error?: string | null;
    promptTokens?: number;
    completionTokens?: number;
  };
  processingDiagnostics?: {
    estimatedTotalSeconds: number;
    elapsedSeconds: number;
    estimateErrorSeconds: number;
  };
  transcriptionDiagnostics?: {
    provider?: string | null;
    fallbackProvider?: string | null;
    fallbackUsed?: boolean;
    chunkCount?: number;
    completedChunks?: number;
    chunkErrors?: number;
    error?: string | null;
  };
  knowledgeSummary?: {
    overview: string;
    participants: Array<{
      name: string;
      role: string;
      evidence: Array<{ startMs: number; endMs: number }>;
    }>;
    stateHistory: Array<{
      startMs: number;
      endMs: number;
      state: string;
      confidence: 'direct' | 'partial';
    }>;
    keyEvents: Array<{
      startMs: number;
      endMs: number;
      event: string;
      confidence: 'direct' | 'partial';
    }>;
    narrative?: Array<{
      startMs: number;
      endMs: number;
      text: string;
      confidence: 'direct' | 'partial';
    }>;
    context: Array<{
      fact: string;
      evidence: Array<{ startMs: number; endMs: number }>;
    }>;
    sourceItems?: Array<{
      kind: 'question' | 'heading' | 'slide-item' | 'board-item' | 'list-item';
      channel: 'spoken' | 'visible';
      text: string;
      answer: string;
      startMs: number;
      endMs: number;
    }>;
    uncertainties: string[];
  };
  answeringGuide: {
    goal?: string;
    importantEntities: string[];
    questionsToPrepareFor: string[];
    extractionFocus?: string[];
    instruction: string;
  };
}

export interface VideoServiceEntitlement {
  plan: string;
  sourceMinutesPerMonth: number | null;
  maxConcurrentJobs: number;
}

export interface VideoServiceUsage {
  periodStart: string;
  periodEnd: string;
  sourceMinutesUsed: number;
  sourceMinutesLimit: number | null;
  activeJobs: number;
  /** Exact active jobs allow a host to recover only its own orphaned asset. */
  activeJobIds?: string[];
  concurrentJobsLimit: number;
}

export interface VideoIntelligenceClientContract {
  health(): Promise<{ status: string; version: string; operators: Record<string, string> }>;
  /** Creates or rotates the opaque cloud credential for one local Larkup installation. */
  provisionDeviceAccess(installationId: string): Promise<{
    apiKey: string;
    entitlement: VideoServiceEntitlement;
  }>;
  upload(file: Blob, fileName: string): Promise<{ uploadId: string }>;
  submitJob(request: SubmitVideoJobRequest): Promise<VideoJob>;
  getJob(jobId: string): Promise<VideoJob>;
  /** Deletes the temporary encrypted result after the caller has validated it. */
  acknowledgeJobResult(jobId: string): Promise<{ status: string }>;
  cancelJob(jobId: string): Promise<VideoJob>;
  /** Removes a local runtime's durable source/result cache for a deleted asset. */
  purgeJobData(jobId: string): Promise<void>;
  getUsage(): Promise<VideoServiceUsage>;
  redeemAccessCode(code: string): Promise<{ apiKey: string; entitlement: VideoServiceEntitlement }>;
}
