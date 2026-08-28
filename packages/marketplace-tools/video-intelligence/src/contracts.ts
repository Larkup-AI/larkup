export type VideoRuntimeMode = 'local-docker' | 'managed-cloud' | 'custom-remote';
export type VideoIndexingMode = 'fast' | 'balanced' | 'deep' | 'full-coverage';
export type VideoContentType = 'general' | 'course' | 'sports' | 'surveillance' | 'meeting';
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

export interface SubmitVideoJobRequest {
  source: VideoSource;
  brief: VideoIndexingBrief;
  idempotencyKey?: string;
  webhookUrl?: string;
}

export interface VideoJobProgress {
  stage:
    | 'queued'
    | 'probe'
    | 'decode'
    | 'transcribe'
    | 'ocr'
    | 'detect'
    | 'synthesize'
    | 'complete';
  percent: number;
  message: string;
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

/** OCR-derived score readings, retained as candidates until the agent verifies them. */
export interface ScoreboardState {
  timeMs: number;
  score: string;
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
  scoreboardStates?: ScoreboardState[];
  entities: Array<{
    name: string;
    kind: 'object' | 'visible-text';
    mentions: number;
    timestampsMs?: number[];
  }>;
  coverage: {
    requested: VideoIndexingMode;
    decodedFrames: number;
    analyzedFrames: number;
    heavyOperatorsDisabled: boolean;
  };
  answeringGuide: {
    goal?: string;
    importantEntities: string[];
    questionsToPrepareFor: string[];
    instruction: string;
  };
}

export interface VideoServiceEntitlement {
  plan: string;
  sourceMinutesPerMonth: number | null;
  maxConcurrentJobs: number;
  allowFullCoverage: boolean;
}

export interface VideoServiceUsage {
  periodStart: string;
  periodEnd: string;
  sourceMinutesUsed: number;
  sourceMinutesLimit: number | null;
  activeJobs: number;
  concurrentJobsLimit: number;
  allowFullCoverage: boolean;
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
  getUsage(): Promise<VideoServiceUsage>;
  redeemAccessCode(code: string): Promise<{ apiKey: string; entitlement: VideoServiceEntitlement }>;
}
