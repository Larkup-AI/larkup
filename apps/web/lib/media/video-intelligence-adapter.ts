import { openAsBlob } from 'node:fs';
import { getInstalledTool } from '@larkup/marketplace/installer';
import { loadToolExtension } from '@larkup/marketplace/extension';
import type { MediaAsset, MediaPipelineStage } from '@larkup/core/types';
import { trackUsageEvent } from '@larkup/core/analytics-store';
import type { OfflineKnowledgeEvidenceInput } from '@larkup/core/video-knowledge/knowledge-builder';
import type { MediaEvidenceSegment } from './knowledge';
import { resolveVideoIntelligenceConnection } from './video-intelligence-connection';
import {
  reconcileVideoIntelligenceCapacity,
  type VideoIntelligenceUsageSnapshot,
} from './video-intelligence-capacity';

/**
 * Distinguishes "the GPU provider never picked this job up in time" from
 * every other failure -- callers use this to tell the model/user the
 * analysis service didn't respond, instead of implying the video itself
 * doesn't show the answer.
 */
export class VideoWorkerTimeoutError extends Error {
  constructor(public readonly lastJobStatus: string) {
    super(`The video analysis worker did not respond in time (last status: ${lastJobStatus}).`);
    this.name = 'VideoWorkerTimeoutError';
  }
}

interface VideoClient {
  health(): Promise<unknown>;
  getUsage(): Promise<{
    sourceMinutesLimit: number | null;
    sourceMinutesUsed: number;
    activeJobs: number;
    concurrentJobsLimit: number;
    activeJobIds?: string[];
  }>;
  provisionDeviceAccess(installationId: string): Promise<{
    apiKey: string;
    entitlement: {
      plan: string;
      sourceMinutesPerMonth: number | null;
      maxConcurrentJobs: number;
    };
  }>;
  upload(file: Blob, fileName: string): Promise<{ uploadId: string }>;
  submitJob(request: Record<string, unknown>): Promise<VideoJob>;
  getJob(jobId: string): Promise<VideoJob>;
  acknowledgeJobResult(jobId: string): Promise<{ status: string }>;
  cancelJob(jobId: string): Promise<VideoJob>;
  purgeJobData?: (jobId: string) => Promise<void>;
  cancelOnlyActiveJob?: () => Promise<{ status: string; alreadyStopped?: boolean }>;
}

/**
 * The control plane owns the source-minute allowance. A managed entitlement
 * with remaining capacity may run its bounded inspection directly; a second
 * host-side budget must not turn a valid paid allowance into an unnecessary
 * browser approval flow.
 */
export async function hasVideoIntelligenceCapacity(): Promise<boolean> {
  const installed = await getInstalledTool('video-intelligence');
  if (!installed) return false;
  const extension = await loadToolExtension<VideoClient>('video-intelligence');
  if (!extension) return false;
  const { config } = await resolveVideoIntelligenceConnection(extension, installed.config);
  const client = extension.createClient({ config, fetch: globalThis.fetch });
  const usage = await client.getUsage();
  return (
    usage.concurrentJobsLimit > 0 &&
    usage.activeJobs < usage.concurrentJobsLimit &&
    (usage.sourceMinutesLimit === null || usage.sourceMinutesUsed < usage.sourceMinutesLimit)
  );
}

export async function getVideoIntelligenceUsage(): Promise<{
  sourceMinutesLimit: number | null;
  sourceMinutesUsed: number;
  activeJobs: number;
  concurrentJobsLimit: number;
  activeJobIds?: string[];
}> {
  const installed = await getInstalledTool('video-intelligence');
  if (!installed) throw new Error('Video Intelligence is not installed.');
  const extension = await loadToolExtension<VideoClient>('video-intelligence');
  if (!extension) throw new Error('The installed Video Intelligence tool could not be loaded.');
  const { config } = await resolveVideoIntelligenceConnection(extension, installed.config);
  return extension.createClient({ config, fetch: globalThis.fetch }).getUsage();
}

export async function getReconciledVideoIntelligenceUsage(
  assets: MediaAsset[],
): Promise<VideoIntelligenceUsageSnapshot> {
  const installed = await getInstalledTool('video-intelligence');
  if (!installed) throw new Error('Video Intelligence is not installed.');
  const extension = await loadToolExtension<VideoClient>('video-intelligence');
  if (!extension) throw new Error('The installed Video Intelligence tool could not be loaded.');
  const { config } = await resolveVideoIntelligenceConnection(extension, installed.config);
  const client = extension.createClient({ config, fetch: globalThis.fetch });
  return reconcileVideoIntelligenceCapacity({
    assets,
    getUsage: () => client.getUsage(),
    getJob: (jobId) => client.getJob(jobId),
    cancelJob: (jobId) => client.cancelJob(jobId),
  });
}

/**
 * Checks credentials and a video-capable model before a source is uploaded,
 * downloaded, or queued. This keeps configuration mistakes out of long-running
 * media jobs and gives the settings screen a useful, actionable error.
 */
export async function validateVideoIntelligenceConfiguration(): Promise<void> {
  const installed = await getInstalledTool('video-intelligence');
  if (!installed) throw new Error('Install Video Intelligence before indexing this video.');
  const extension = await loadToolExtension<VideoClient>('video-intelligence');
  if (!extension) throw new Error('The installed Video Intelligence tool could not be loaded.');
  const { config } = await resolveVideoIntelligenceConnection(extension, installed.config);
  assertVideoIntelligenceConfiguration(config);
}

/** Cancels the managed job before its MediaAsset is deleted. */
export async function cancelVideoIntelligenceJob(jobId: string): Promise<void> {
  const installed = await getInstalledTool('video-intelligence');
  if (!installed) return;
  const extension = await loadToolExtension<VideoClient>('video-intelligence');
  if (!extension) return;
  const { config } = await resolveVideoIntelligenceConnection(extension, installed.config);
  const client = extension.createClient({ config, fetch: globalThis.fetch });
  const job = await client.getJob(jobId);
  if (job.status === 'queued' || job.status === 'running') await client.cancelJob(jobId);
}

/** Removes the local runtime's retained source/result after its host asset is deleted. */
export async function purgeLocalVideoIntelligenceJobData(jobId: string): Promise<void> {
  const installed = await getInstalledTool('video-intelligence');
  if (!installed) return;
  const extension = await loadToolExtension<VideoClient>('video-intelligence');
  if (!extension) return;
  const { config } = await resolveVideoIntelligenceConnection(extension, installed.config);
  if (runtimeModeFor(config) !== 'local') return;
  const client = extension.createClient({ config, fetch: globalThis.fetch });
  if (typeof client.purgeJobData !== 'function') return;
  await client.purgeJobData(jobId);
}

/** Stops exactly one orphaned cloud job. The service rejects multiple jobs. */
export async function cancelOnlyActiveVideoIntelligenceJob(): Promise<void> {
  const installed = await getInstalledTool('video-intelligence');
  if (!installed) throw new Error('Video Intelligence is not installed.');
  const extension = await loadToolExtension<VideoClient>('video-intelligence');
  if (!extension) throw new Error('The installed Video Intelligence tool could not be loaded.');
  const { config } = await resolveVideoIntelligenceConnection(extension, installed.config);
  const client = extension.createClient({ config, fetch: globalThis.fetch });
  if (typeof client.cancelOnlyActiveJob !== 'function') {
    throw new Error('Update Video Intelligence before stopping an orphaned cloud job.');
  }
  await client.cancelOnlyActiveJob();
}

interface VideoJob {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: {
    stage: string;
    percent: number;
    message: string;
    stagePercent?: number;
    sequence?: number;
    elapsedSeconds?: number;
    estimatedRemainingSeconds?: number;
    current?: number;
    total?: number;
    unit?: string;
  };
  result: VideoEvidence | null;
  error: string | null;
}

interface CloudProgressCounter {
  current: number;
  total: number;
}

interface CloudProgressCounters {
  captions?: CloudProgressCounter;
  searchClips?: CloudProgressCounter;
  combined?: CloudProgressCounter;
}

interface VideoEvidence {
  durationMs: number;
  video: { width: number; height: number; fps: number };
  transcript: Array<{ startMs: number; endMs: number; text: string }>;
  visualObservations: Array<{
    timeMs: number;
    objects: Array<{ label: string; trackId: number; confidence: number }>;
    ocr: Array<{ text: string; confidence: number }>;
  }>;
  tracks: Array<{
    trackId: number;
    label: string;
    startMs: number;
    endMs: number;
    observations: number;
    confidence?: number;
  }>;
  recurringOverlayText?: Array<{
    text: string;
    firstSeenMs: number;
    lastSeenMs: number;
    observations: number;
    timestampsMs?: number[];
    confidence: number;
  }>;
  semanticObservations?: Array<{
    startMs: number;
    endMs: number;
    text: string;
    confidence: number;
  }>;
  semanticDiagnostics?: {
    attempted?: boolean;
    error?: string | null;
  };
  agentDiagnostics?: {
    attempted?: boolean;
    provider?: string;
    model?: string;
    requests?: number;
    latencyMs?: number;
    fallback?: boolean;
    error?: string | null;
    promptTokens?: number;
    completionTokens?: number;
  };
  processingDiagnostics?: {
    estimatedTotalSeconds?: number;
    elapsedSeconds?: number;
    estimateErrorSeconds?: number;
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
    overview?: string;
    participants?: Array<{
      name: string;
      role: string;
      evidence: Array<{ startMs: number; endMs: number }>;
    }>;
    stateHistory?: Array<{
      startMs: number;
      endMs: number;
      state: string;
      confidence: 'direct' | 'partial';
    }>;
    keyEvents?: Array<{
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
    context?: Array<{
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
    uncertainties?: string[];
  };
  coverage?: {
    requested?: 'fast' | 'balanced' | 'thorough';
    sourceFrames?: number;
    decodedFrames?: number;
    analyzedFrames?: number;
    semanticClips?: number;
  };
  videoEmbeddings?: Array<{
    clipId: string;
    startMs: number;
    endMs: number;
    vector: number[];
    dimensions: number;
    provider: string;
  }>;
  videoEmbeddingDiagnostics?: {
    attempted?: boolean;
    provider?: string;
    error?: string | null;
  };
  detectedLanguage?: string;
  answeringGuide: {
    goal?: string;
    importantEntities: string[];
    questionsToPrepareFor: string[];
    instruction: string;
  };
}

export function createVideoIntelligenceSubmitRequest(input: {
  source: Record<string, unknown>;
  brief: Record<string, unknown>;
  config?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    source: input.source,
    brief: input.brief,
    ...(input.config && runtimeModeFor(input.config) !== 'local'
      ? { modelConfiguration: resolveVideoJobModelConfiguration(input.config) }
      : {}),
  };
}

type ReportStage = (
  stage: MediaPipelineStage,
  patch: {
    status: 'running' | 'completed';
    percent?: number;
    current?: number;
    total?: number;
    unit?: string;
    sequence?: number;
    elapsedSeconds?: number;
    estimatedRemainingSeconds?: number;
    message: string;
    startedAt?: string;
    /**
     * The dispatched job's own status, when known. 'queued' means the GPU
     * worker hasn't picked the job up yet (cold start) -- distinct from
     * `status` above, which is about this reporting call's own stage, not
     * the underlying job.
     */
    jobStatus?: 'queued' | 'running';
  },
) => Promise<void>;

export async function runInstalledVideoIntelligence(input: {
  asset: MediaAsset;
  mediaPath: string;
  reportStage: ReportStage;
  briefOverride?: Record<string, unknown>;
  /** Bounded cloud inspection reserves only the requested source range. */
  sourceDurationSecs?: number;
  /**
   * A presigned HTTPS URL to an already-durable canonical copy (the web
   * app's own S3StorageProvider). When set, this skips openAsBlob + the
   * client.upload() multipart round-trip entirely -- the control plane
   * dispatches the GPU worker straight at this URL, which is what lets
   * watch_original re-inspect a video long after its original upload
   * expired without ever re-transferring the file through this process.
   */
  sourceUrl?: string;
  /** Persists the managed job ID immediately so deletion can cancel it. */
  onJobSubmitted?: (jobId: string) => Promise<void>;
  /** Prevents a removed asset from submitting a new managed job. */
  assertStillActive?: () => Promise<void>;
  /**
   * How long to wait for the dispatched job before giving up. Full-video
   * indexing runs unattended, so it keeps the long default; a chat-triggered
   * bounded inspection has a live user waiting on a response and must fail
   * fast (with a clear timeout error the caller can distinguish from "the
   * video doesn't show this") if the GPU provider never picks the job up,
   * rather than hang for hours.
   */
  maxWaitMs?: number;
}): Promise<{
  evidence: VideoEvidence;
  segments: MediaEvidenceSegment[];
}> {
  const installed = await getInstalledTool('video-intelligence');
  if (!installed) throw new Error('Install Video Intelligence (New) before indexing this video.');
  const extension = await loadToolExtension<VideoClient>('video-intelligence');
  if (!extension) throw new Error('The installed Video Intelligence tool could not be loaded.');
  const { config } = await resolveVideoIntelligenceConnection(extension, installed.config);
  assertVideoIntelligenceConfiguration(config);
  const context = { config, fetch: globalThis.fetch };
  await input.reportStage('extract', {
    status: 'running',
    percent: 1,
    message: 'Connecting to the configured Video Intelligence runtime...',
  });
  const client = extension.createClient(context);
  try {
    await extension.ensureRuntime?.(context);
    await client.health();
  } catch (error) {
    throw new Error(
      `Video Intelligence connection check failed: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    );
  }
  const uploaded = input.sourceUrl
    ? null
    : await client.upload(
        await openAsBlob(input.mediaPath, { type: input.asset.mimeType }),
        input.asset.fileName,
      );
  const brief: Record<string, unknown> = enforceManagedSemanticBrief(config, {
    ...normalizeBrief(input.asset),
    ...(input.briefOverride ?? {}),
    // Managed indexing has a semantic reader for normal visual understanding.
    // Local indexing is offline-only, so it must retain OCR and detection as
    // the source of visual evidence rather than producing a speech-only index.
    skipHeavyOperators: shouldSkipHeavyVideoOperators(config, input.briefOverride),
    // Fast Cloud coverage is explicitly a visual overview. Avoid making its
    // completion wait on a full Whisper pass, which can dominate a short
    // video after a worker cold start; balanced/deep indexing still includes
    // timestamped speech by default.
    ...(shouldSkipCloudTranscription(config, input.briefOverride, input.asset)
      ? { skipTranscription: true }
      : {}),
    // Fast is an evidence-backed overview: semantic captions are the source
    // for chat, while video-vector embeddings are an optional secondary
    // retrieval index. Do not make a user wait for that expensive remote
    // index (or its provider queue) before a Fast video is searchable.
    ...(shouldSkipCloudVideoEmbeddings(config, input.briefOverride, input.asset)
      ? { skipVideoEmbeddings: true }
      : {}),
  });
  // Normalizing an unbounded source through the worker's single-range path
  // guarantees an H.264 analysis file. Some browser codecs transcribe fine
  // but OpenCV cannot yield frames after a stream-copy materialization, which
  // otherwise silently drops all OCR/object/VLM evidence from a full index.
  const effectiveDurationSecs = input.sourceDurationSecs ?? input.asset.durationSecs;
  if (
    (!Array.isArray(brief.importantRanges) || brief.importantRanges.length === 0) &&
    Number.isFinite(effectiveDurationSecs) &&
    Number(effectiveDurationSecs) > 0
  ) {
    brief.importantRanges = [
      { startSecs: 0, endSecs: Number(effectiveDurationSecs), note: 'full-index-normalization' },
    ];
  }
  await input.assertStillActive?.();
  let job: VideoJob;
  try {
    job = await client.submitJob(
      createVideoIntelligenceSubmitRequest({
        source: {
          ...(input.sourceUrl ? { url: input.sourceUrl } : { uploadId: uploaded!.uploadId }),
          fileName: input.asset.fileName,
          mimeType: input.asset.mimeType,
          // `durationSecs` is the billable bounded clip duration for a live
          // inspection. The worker still needs the original timeline length
          // to distinguish a 0:00–0:20 inspection from an entire 20-second
          // source, otherwise it downloads and plans the full recording.
          ...(Number.isFinite(input.asset.durationSecs) && Number(input.asset.durationSecs) > 0
            ? { timelineDurationSecs: Number(input.asset.durationSecs) }
            : {}),
          durationSecs: effectiveDurationSecs,
        },
        brief,
        config,
      }),
    );
  } catch (error) {
    throw new Error(
      `Video Intelligence job submission failed: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    );
  }
  try {
    await input.onJobSubmitted?.(job.id);
  } catch (error) {
    await client.cancelJob(job.id).catch(() => undefined);
    throw error;
  }
  const maxWaitMs = input.maxWaitMs ?? 6 * 60 * 60_000;
  // Queuing and execution are distinct provider phases. A worker can become
  // available near the end of a cold-start allowance; do not cancel a job
  // that has already started processing solely because it spent time queued.
  let deadline = Date.now() + maxWaitMs;
  let previousJobStatus = job.status;
  let reportedCloudStage = '';
  let cloudStageStartedAt = Date.now();
  let lastRemoteProgressSignature = '';
  let lastRemoteProgressAt = Date.now();
  const runningStallTimeoutMs = Math.min(maxWaitMs, 3 * 60_000);
  while (job.status === 'queued' || job.status === 'running') {
    if (Date.now() >= deadline) {
      await client.cancelJob(job.id).catch(() => undefined);
      throw new VideoWorkerTimeoutError(job.status);
    }
    const remoteProgressSignature = JSON.stringify({
      status: job.status,
      stage: job.progress.stage,
      percent: job.progress.percent,
      stagePercent: job.progress.stagePercent,
      sequence: job.progress.sequence,
      current: job.progress.current,
      total: job.progress.total,
      message: job.progress.message,
    });
    const hasFreshRemoteProgress = remoteProgressSignature !== lastRemoteProgressSignature;
    if (hasFreshRemoteProgress) {
      lastRemoteProgressSignature = remoteProgressSignature;
      lastRemoteProgressAt = Date.now();
    } else if (
      job.status === 'running' &&
      Date.now() - lastRemoteProgressAt >= runningStallTimeoutMs
    ) {
      await client.cancelJob(job.id).catch(() => undefined);
      throw new Error(
        'The video analysis worker stopped reporting progress for 3 minutes. The job was cancelled safely; retry to use a fresh worker.',
      );
    }
    if (job.progress.stage !== reportedCloudStage) {
      await completePreviousCloudStage(reportedCloudStage, input.reportStage);
      reportedCloudStage = job.progress.stage;
      cloudStageStartedAt = Date.now();
    }
    if (hasFreshRemoteProgress) {
      const progress = cloudStageProgress(job.progress);
      await input.reportStage(mapStage(job.progress.stage), {
        status: 'running',
        jobStatus: job.status === 'queued' ? 'queued' : 'running',
        ...progress,
        // The semantic-reader and embedding counters begin after the local
        // decode/detect work. Reset the clock here so its ETA is based on the
        // actual remote work, not the entire video job.
        ...(job.progress.stage === 'synthesize'
          ? { startedAt: new Date(cloudStageStartedAt).toISOString() }
          : {}),
        message: job.progress.message,
      });
    }
    // Worker telemetry arrives every few seconds. Poll below the managed
    // control-plane rate limit while keeping every heartbeat visible.
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    job = await client.getJob(job.id);
    if (job.status === 'running' && previousJobStatus !== 'running') {
      deadline = Date.now() + maxWaitMs;
    }
    previousJobStatus = job.status;
  }
  if (job.status !== 'completed' || !job.result) {
    throw new Error(job.error || `Video indexing ended with status ${job.status}.`);
  }
  const semanticDiagnostics = job.result.semanticDiagnostics;
  const semanticFailure = shouldRequireSemanticVideoEvidence(
    config,
    semanticDiagnostics,
    job.result.semanticObservations,
  );
  if (semanticFailure) {
    const detail = semanticDiagnostics?.error
      ? `: ${semanticDiagnostics.error}`
      : !semanticDiagnostics
        ? ': the Larkup Cloud worker returned an incomplete semantic-evidence result. Retry after updating the Cloud worker.'
        : '';
    throw new Error(`Video semantic analysis did not return validated evidence${detail}`);
  }
  const agent = job.result.agentDiagnostics;
  if (agent?.attempted && agent.model) {
    const promptTokens = agent.promptTokens ?? 0;
    const completionTokens = agent.completionTokens ?? 0;
    void trackUsageEvent({
      type: 'media_processing',
      mediaType: 'video',
      mediaOperation: 'extraction',
      modelId: agent.model,
      provider: agent.provider,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      latencyMs: agent.latencyMs,
      durationSecs: job.result.durationMs / 1_000,
      frameCount: job.result.coverage?.analyzedFrames,
      observationCount:
        job.result.visualObservations.length + (job.result.semanticObservations?.length ?? 0),
      runtime: runtimeModeFor(config) === 'local' ? 'local' : 'remote',
      timestamp: new Date().toISOString(),
    });
  }
  // The control plane retains source/result data only until this explicit
  // acknowledgement. Do this only after validation, so a failed evidence
  // check remains diagnosable and can be recovered instead of deleting the
  // worker's result before the user sees the reason.
  // Installed marketplace extensions are hot-loaded. Older still-supported
  // clients acknowledge from getJob(), while newer ones expose the explicit
  // acknowledgement method above. Support both during the rollout.
  if (typeof client.acknowledgeJobResult === 'function') {
    await client.acknowledgeJobResult(job.id).catch(() => undefined);
  }
  await input.reportStage('vision', {
    status: 'completed',
    percent: 100,
    message: `Analyzed ${job.result.visualObservations.length} timestamped visual observations.`,
  });
  await input.reportStage('transcribe', {
    status: 'completed',
    percent: 100,
    message: `Transcribed ${job.result.transcript.length} timestamped speech sections.`,
  });
  await input.reportStage('extract', {
    status: 'completed',
    percent: 100,
    message: 'Video evidence selected.',
  });
  return { evidence: job.result, segments: evidenceToSegments(job.result) };
}

export function shouldRequireSemanticVideoEvidence(
  config: Record<string, unknown>,
  diagnostics: VideoEvidence['semanticDiagnostics'],
  observations: VideoEvidence['semanticObservations'] = [],
): boolean {
  const hasUsableEvidence = observations.some((observation) => observation.text.trim());
  return runtimeModeFor(config) !== 'local' && (!diagnostics?.attempted || !hasUsableEvidence);
}

/** Managed indexes must contain actual visual-language evidence, not speech/OCR alone. */
export function enforceManagedSemanticBrief(
  config: Record<string, unknown>,
  brief: Record<string, unknown>,
): Record<string, unknown> {
  return runtimeModeFor(config) === 'local' ? brief : { ...brief, requireSemanticVision: true };
}

export function shouldSkipHeavyVideoOperators(
  _config: Record<string, unknown>,
  briefOverride?: Record<string, unknown>,
): boolean {
  if (typeof briefOverride?.skipHeavyOperators === 'boolean') {
    return briefOverride.skipHeavyOperators;
  }
  return false;
}

export function shouldSkipCloudTranscription(
  _config: Record<string, unknown>,
  briefOverride: Record<string, unknown> | undefined,
  _asset: MediaAsset,
): boolean {
  return briefOverride?.skipTranscription === true;
}

export function shouldSkipCloudVideoEmbeddings(
  _config: Record<string, unknown>,
  briefOverride: Record<string, unknown> | undefined,
  _asset: MediaAsset,
): boolean {
  return briefOverride?.skipVideoEmbeddings === true;
}

export function assertVideoIntelligenceConfiguration(config: Record<string, unknown>): void {
  const models = resolveVideoJobModelConfiguration(config);
  if (!/gemini.*(?:flash|vision)|qwen.*vl|gpt-4o|gpt-4\.1/i.test(models.vision.model)) {
    throw new Error(
      `Before indexing starts, choose a video-capable vision model. "${models.vision.model}" is not supported for video analysis.`,
    );
  }
}

export function resolveVideoJobModelConfiguration(config: Record<string, unknown>) {
  const value = (candidate: unknown) =>
    typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined;
  const visionOverride = value(config.videoVisionProvider);
  const globalVisionProvider = value(config.larkupVisionProvider);
  const visionProvider =
    visionOverride && visionOverride !== 'auto'
      ? visionOverride
      : (globalVisionProvider ?? 'vercel_ai_gateway');
  const visionApiKey =
    (visionOverride && visionOverride !== 'auto' ? value(config.videoVisionApiKey) : undefined) ??
    (globalVisionProvider === visionProvider ? value(config.larkupVisionApiKey) : undefined) ??
    value(config.visionGatewayApiKey);
  const visionModelOverride = value(config.semanticVisionModel);
  const visionModel =
    (visionModelOverride && visionModelOverride !== 'auto' ? visionModelOverride : undefined) ??
    (globalVisionProvider === visionProvider ? value(config.larkupVisionModel) : undefined) ??
    (visionProvider === 'google'
      ? 'google/gemini-3.6-flash'
      : visionProvider === 'openai'
        ? 'openai/gpt-4o-mini'
        : 'google/gemini-3.6-flash');

  const brainOverride = value(config.videoAgentProvider);
  const globalBrainProvider = value(config.larkupAgentProvider);
  const brainProvider =
    brainOverride && brainOverride !== 'auto'
      ? brainOverride
      : (globalBrainProvider ?? 'vercel_ai_gateway');
  const brainApiKey =
    (brainOverride && brainOverride !== 'auto' ? value(config.videoAgentApiKey) : undefined) ??
    (globalBrainProvider === brainProvider ? value(config.larkupAgentApiKey) : undefined) ??
    (brainProvider === visionProvider ? visionApiKey : undefined);
  const brainModelOverride = value(config.agentModel);
  const brainModel =
    (brainModelOverride && brainModelOverride !== 'auto' ? brainModelOverride : undefined) ??
    (globalBrainProvider === brainProvider ? value(config.larkupAgentModel) : undefined) ??
    (brainProvider === 'google' ? 'google/gemini-3.5-flash-lite' : 'openai/gpt-5-mini');

  const audioProvider = value(config.audioProvider) ?? 'deepgram';
  const audioApiKey = value(config.audioApiKey);
  const audioModel = {
    openai: 'whisper-1',
    groq: 'whisper-large-v3-turbo',
    deepgram: 'nova-3',
    elevenlabs: 'scribe_v2',
  }[audioProvider] as string | undefined;

  const supportedVisionProviders = new Set(['vercel_ai_gateway', 'google', 'openai']);
  const supportedBrainProviders = new Set([
    'vercel_ai_gateway',
    'google',
    'openai',
    'deepseek',
    'mistral',
    'cohere',
    'anthropic',
  ]);
  if (!supportedVisionProviders.has(visionProvider)) {
    throw new Error(
      `Video vision cannot use "${visionProvider}". Choose Google, OpenAI, or Vercel AI Gateway under Settings → AI Models → Vision Model.`,
    );
  }
  if (!supportedBrainProviders.has(brainProvider)) {
    throw new Error(`Agent / tool-brain provider "${brainProvider}" is not supported.`);
  }
  if (!new Set(['openai', 'groq', 'deepgram', 'elevenlabs']).has(audioProvider)) {
    throw new Error(`Audio provider "${audioProvider}" is not supported.`);
  }
  if (!visionApiKey) {
    throw new Error(
      'Before indexing starts, configure a vision provider and API key in Video Intelligence or under Settings → AI Models → Vision Model. Text-only providers such as DeepSeek need a separate vision provider. The video was not uploaded or downloaded.',
    );
  }
  if (!brainApiKey) {
    throw new Error(
      'Before indexing starts, add the selected agent provider API key in Video Intelligence or under Settings → AI Models. The video was not uploaded or downloaded.',
    );
  }
  if (!audioApiKey) {
    throw new Error(
      'Before indexing starts, add the selected audio provider API key in Video Intelligence settings. The video was not uploaded or downloaded.',
    );
  }
  if (!audioModel) {
    throw new Error(`Audio provider "${audioProvider}" has no automatic transcription model.`);
  }
  return {
    audio: { provider: audioProvider, apiKey: audioApiKey!, model: audioModel! },
    brain: { provider: brainProvider, apiKey: brainApiKey!, model: brainModel },
    vision: { provider: visionProvider, apiKey: visionApiKey!, model: visionModel },
  };
}

function runtimeModeFor(config: Record<string, unknown>): string {
  const value = typeof config.runtimeMode === 'string' ? config.runtimeMode : '';
  if (value === 'local' || value === 'local-docker' || value === 'local-process') return 'local';
  return value === 'custom-remote' ? 'custom-remote' : 'managed-cloud';
}

/** Pull all independently-completed remote units out of the worker message. */
function cloudProgressCounters(message: string): CloudProgressCounters {
  const counters = [
    ...message.matchAll(
      /(\d[\d,]*)\s*\/\s*(\d[\d,]*)\s+(captions|described|indexed|search clips|clips)\b/gi,
    ),
  ]
    .map((match) => ({
      current: Number(match[1].replaceAll(',', '')),
      total: Number(match[2].replaceAll(',', '')),
      kind: match[3].toLowerCase(),
    }))
    .filter((counter) => Number.isFinite(counter.current) && Number.isFinite(counter.total));
  const combined = counters.reduce<CloudProgressCounter | undefined>(
    (combined, counter) => ({
      current: (combined?.current ?? 0) + Math.min(counter.current, counter.total),
      total: (combined?.total ?? 0) + counter.total,
    }),
    undefined,
  );
  const captions = counters.find(
    (counter) => counter.kind === 'captions' || counter.kind === 'described',
  );
  const searchClips = counters.find(
    (counter) =>
      counter.kind === 'search clips' || counter.kind === 'clips' || counter.kind === 'indexed',
  );
  return {
    captions: captions && { current: captions.current, total: captions.total },
    searchClips: searchClips && { current: searchClips.current, total: searchClips.total },
    combined,
  };
}

/**
 * Translate the worker's overall percent into the mapped UI step's own band,
 * preferring its true completed/total clip units whenever it reports them.
 */
export function cloudStageProgress(progress: VideoJob['progress']): {
  percent: number;
  current?: number;
  total?: number;
  unit?: string;
  sequence?: number;
  elapsedSeconds?: number;
  estimatedRemainingSeconds?: number;
} {
  const runtimeDetails = {
    ...(Number.isFinite(progress.sequence) ? { sequence: progress.sequence } : {}),
    ...(Number.isFinite(progress.elapsedSeconds)
      ? { elapsedSeconds: progress.elapsedSeconds }
      : {}),
    ...(Number.isFinite(progress.estimatedRemainingSeconds)
      ? { estimatedRemainingSeconds: progress.estimatedRemainingSeconds }
      : {}),
  };
  // Unlike a queue placeholder, this is FFmpeg's measured timestamp while
  // the Cloud worker copies/normalizes the source. Keep it as a normal,
  // determinate step so a long source never appears stuck at 5%.
  if (progress.stage === 'prepare') {
    return {
      percent: cloudOverallToStagePercent('prepare', progress.percent, progress.stagePercent),
      ...(Number.isFinite(progress.current) ? { current: progress.current } : {}),
      ...(Number.isFinite(progress.total) ? { total: progress.total } : {}),
      ...(progress.unit ? { unit: progress.unit } : {}),
      ...runtimeDetails,
    };
  }
  if (progress.stage === 'synthesize') {
    const counters = cloudProgressCounters(progress.message);
    if (counters.combined && counters.combined.total > 0) {
      const etaCounter =
        counters.captions && counters.captions.current < counters.captions.total
          ? counters.captions
          : counters.searchClips;
      return {
        percent: cloudOverallToStagePercent(
          progress.stage,
          progress.percent,
          progress.stagePercent,
        ),
        current: etaCounter?.current ?? counters.combined.current,
        total: etaCounter?.total ?? counters.combined.total,
        unit: etaCounter === counters.captions ? 'captions' : 'search clips',
        ...runtimeDetails,
      };
    }
    return {
      percent: cloudOverallToStagePercent(progress.stage, progress.percent, progress.stagePercent),
      ...runtimeDetails,
    };
  }
  return {
    percent: cloudOverallToStagePercent(progress.stage, progress.percent, progress.stagePercent),
    ...(Number.isFinite(progress.current) ? { current: progress.current } : {}),
    ...(Number.isFinite(progress.total) ? { total: progress.total } : {}),
    ...(progress.unit ? { unit: progress.unit } : {}),
    ...runtimeDetails,
  };
}

/**
 * Convert the worker's overall percent into progress within the mapped UI
 * step, from the phase table the worker itself reports against. The worker
 * already advances that percent smoothly and monotonically, so there is
 * nothing left for the host to smooth or guess at.
 */
export function cloudOverallToStagePercent(
  stage: string,
  overallPercent: number,
  stagePercent?: number,
): number {
  // The runtime knows which slice of its bar the current stage owns, so it
  // reports how far through that stage it is. Taking it at its word keeps a
  // per-step bar correct through any change to the pipeline's shape; the
  // fallback only covers a runtime old enough not to send it.
  if (typeof stagePercent === 'number' && Number.isFinite(stagePercent)) {
    return Math.max(0, Math.min(99, Math.round(stagePercent)));
  }
  // Preparation runs before the pipeline and reports its own share directly.
  if (stage === 'prepare') return Math.min(99, Math.round((overallPercent / 25) * 100));
  return Math.max(0, Math.min(99, Math.round(overallPercent)));
}

/**
 * Preserve source-level cloud observations for the investigation engine. The
 * 30-second RAG segments above are useful navigation projections, but they
 * must never be the only evidence used for an exact score or count.
 */
export function evidenceToKnowledgeInputs(evidence: VideoEvidence) {
  const visualObservations = [
    ...evidence.visualObservations.flatMap((observation) => {
      if (!observation.objects.length) return [];
      const timestampSecs = observation.timeMs / 1_000;
      const objects = observation.objects.map((object) => ({
        label: object.label,
        trackId: object.trackId,
        confidence: object.confidence,
      }));
      return [
        {
          startSecs: timestampSecs,
          endSecs: timestampSecs,
          observations: [
            {
              kind: 'object' as const,
              value: `Detected objects: ${objects
                .map((object) => `${object.label} (track ${object.trackId})`)
                .join(', ')}`,
              frameTimestamps: [timestampSecs],
              confidence:
                objects.reduce((total, object) => total + object.confidence, 0) /
                Math.max(1, objects.length),
              uncertaintyReasons: ['Object labels are produced by the video detector.'],
            },
          ],
        },
      ];
    }),
    ...(evidence.recurringOverlayText ?? []).map((overlay) => ({
      startSecs: overlay.firstSeenMs / 1_000,
      endSecs: overlay.lastSeenMs / 1_000,
      observations: [
        {
          kind: 'state' as const,
          // Recurring on-screen text says a display was present over a span
          // and when it changed. The distinct schema keeps it a locator: what
          // the text means is established by reading the frames.
          value: {
            subject: 'on-screen-text',
            property: 'recurring-overlay',
            value: overlay.text,
            observations: overlay.observations,
            firstSeenMs: overlay.firstSeenMs,
            lastSeenMs: overlay.lastSeenMs,
          },
          frameTimestamps: (overlay.timestampsMs ?? [overlay.firstSeenMs]).map(
            (timestamp) => timestamp / 1_000,
          ),
          confidence: overlay.confidence,
          uncertaintyReasons: [
            'Recurring on-screen text read by OCR. Use it to locate a source range for visual verification; it does not establish what the text refers to.',
          ],
        },
      ],
    })),
    ...(evidence.semanticObservations ?? [])
      .filter((observation) => observation.text.trim())
      .map((observation) => ({
        startSecs: observation.startMs / 1_000,
        endSecs: observation.endMs / 1_000,
        observations: [
          {
            kind: 'action' as const,
            value: observation.text,
            frameTimestamps: [observation.startMs / 1_000, observation.endMs / 1_000],
            confidence: Math.min(1, Math.max(0, observation.confidence)),
            uncertaintyReasons: [
              'Semantic VLM interpretation is grounded in a bounded sequence of cloud-analyzed frames.',
            ],
          },
        ],
      })),
  ];
  const ocrEvidence = evidence.visualObservations.flatMap((observation) => {
    const timestampSecs = observation.timeMs / 1_000;
    return observation.ocr
      .filter((line) => line.text.trim() && line.confidence >= 0.35)
      .map((line) => ({
        modality: 'ocr' as const,
        timeRange: {
          startSecs: timestampSecs,
          endSecs: timestampSecs,
          precision: 'estimated' as const,
        },
        payload: {
          text: line.text,
          blocks: [{ text: line.text, confidence: line.confidence }],
        },
        source: { kind: 'provider' as const, provider: 'video-intelligence-ocr' },
        confidence: {
          score: Math.min(1, Math.max(0, line.confidence)),
          source: 'provider' as const,
          calibrationStatus: 'uncalibrated' as const,
          uncertaintyReasons: ['OCR derived from a timestamped cloud analysis frame.'],
        },
        observation: { kind: 'ocr' as const, value: { text: line.text } },
      }));
  });
  return {
    transcriptChunks: evidence.transcript.map((segment) => ({
      text: segment.text,
      startSecs: segment.startMs / 1_000,
      endSecs: segment.endMs / 1_000,
    })),
    visualObservations,
    ocrEvidence,
    reconciledEvidence: reconciledAccount(evidence),
  };
}

/** Converts a bounded cloud re-analysis result into immutable refinement evidence. */
export function evidenceToRefinementInputs(
  evidence: VideoEvidence,
): OfflineKnowledgeEvidenceInput[] {
  const inputs = evidenceToKnowledgeInputs(evidence);
  const transcript: OfflineKnowledgeEvidenceInput[] = inputs.transcriptChunks.map((chunk) => ({
    modality: 'transcript',
    timeRange: { startSecs: chunk.startSecs, endSecs: chunk.endSecs, precision: 'segment' },
    payload: { text: chunk.text },
    source: { kind: 'provider', provider: 'video-intelligence-stt' },
    confidence: {
      score: 0.8,
      source: 'provider',
      calibrationStatus: 'uncalibrated',
      uncertaintyReasons: ['Timestamped transcript returned by bounded cloud analysis.'],
    },
    observation: { kind: 'speech', value: { text: chunk.text } },
  }));
  const visual: OfflineKnowledgeEvidenceInput[] = inputs.visualObservations.flatMap((sequence) =>
    (sequence.observations ?? []).map((observation) => ({
      modality: 'visual' as const,
      timeRange: {
        startSecs: sequence.startSecs,
        endSecs: sequence.endSecs,
        precision: 'estimated' as const,
      },
      payload: { text: observation.value },
      source: { kind: 'provider' as const, provider: 'video-intelligence-vision' },
      confidence: {
        score: observation.confidence,
        source: 'provider' as const,
        calibrationStatus: 'uncalibrated' as const,
        uncertaintyReasons: observation.uncertaintyReasons,
      },
      observation: { kind: observation.kind, value: observation.value },
    })),
  );
  const trackedPeople = evidence.tracks.filter((track) => track.label.toLowerCase() === 'person');
  const tracking: OfflineKnowledgeEvidenceInput[] = trackedPeople.length
    ? [
        {
          modality: 'computed',
          timeRange: {
            startSecs: Math.min(...trackedPeople.map((track) => track.startMs / 1_000)),
            endSecs: Math.max(...trackedPeople.map((track) => track.endMs / 1_000)),
            precision: 'estimated',
          },
          payload: {
            method: 'video-intelligence-anonymous-person-tracking',
            tracks: trackedPeople.map((track) => ({
              id: track.trackId,
              startSecs: track.startMs / 1_000,
              endSecs: track.endMs / 1_000,
              observations: track.observations,
              confidence: track.confidence ?? null,
            })),
          },
          source: { kind: 'provider', provider: 'video-intelligence-tracking' },
          confidence: {
            score:
              trackedPeople.reduce((total, track) => total + (track.confidence ?? 0.65), 0) /
              trackedPeople.length,
            source: 'provider',
            calibrationStatus: 'uncalibrated',
            uncertaintyReasons: [
              'This is an anonymous track count within the inspected range, not person identity.',
              'Occlusion and re-entry can cause an undercount or duplicate track.',
            ],
          },
          observation: {
            kind: 'computed',
            value: {
              count: trackedPeople.length,
              label: 'person',
              method: 'anonymous-bounded-tracking',
            },
          },
        },
      ]
    : [];
  return [
    ...transcript,
    ...visual,
    ...inputs.ocrEvidence,
    ...tracking,
    ...reconciledAccount(evidence),
  ];
}

/**
 * The index's own reconciled account of the source, as retrievable evidence.
 *
 * Individual readings of the same moment disagree -- one clip reads a display
 * one way and the next reads it the other. The runtime already resolves that:
 * it cross-checks every claim against the rest of the timeline and keeps only
 * what survives. Without this, retrieval only ever sees the raw readings and
 * can surface the one that lost, so the answer contradicts the index that
 * produced it. Each item carries the span it was drawn from and the
 * uncertainties the check left open.
 */
function reconciledAccount(evidence: VideoEvidence): OfflineKnowledgeEvidenceInput[] {
  const summary = evidence.knowledgeSummary;
  if (!summary) return [];
  const durationSecs = evidence.durationMs / 1_000;
  const entry = (
    startSecs: number,
    endSecs: number,
    text: string,
    confidence: number,
  ): OfflineKnowledgeEvidenceInput => ({
    modality: 'computed',
    timeRange: {
      startSecs: Math.max(0, Math.min(durationSecs, startSecs)),
      endSecs: Math.max(0, Math.min(durationSecs, Math.max(startSecs, endSecs))),
      precision: 'estimated',
    },
    payload: { text },
    source: { kind: 'provider', provider: 'video-intelligence-index' },
    confidence: {
      score: confidence,
      source: 'heuristic',
      calibrationStatus: 'uncalibrated',
      uncertaintyReasons: [
        'The index reconciled this across the whole timeline; it is not a single reading.',
        ...(summary.uncertainties ?? []).slice(0, 4),
      ],
    },
    observation: { kind: 'computed', value: { text } },
  });
  const score = (confidence: 'direct' | 'partial') => (confidence === 'direct' ? 0.82 : 0.6);
  return [
    ...(summary.overview
      ? [entry(0, durationSecs, `Reconciled overview: ${summary.overview}`, 0.75)]
      : []),
    ...(summary.stateHistory ?? []).map((state) =>
      entry(
        state.startMs / 1_000,
        state.endMs / 1_000,
        `Reconciled state: ${state.state}`,
        score(state.confidence),
      ),
    ),
    ...(summary.keyEvents ?? []).map((event) =>
      entry(
        event.startMs / 1_000,
        event.endMs / 1_000,
        `Reconciled event: ${event.event}`,
        score(event.confidence),
      ),
    ),
    ...(summary.narrative ?? []).map((note) =>
      entry(
        note.startMs / 1_000,
        note.endMs / 1_000,
        `Chronological note: ${note.text}`,
        score(note.confidence),
      ),
    ),
    ...(summary.participants ?? []).flatMap((participant) =>
      participant.evidence
        .slice(0, 1)
        .map((range) =>
          entry(
            range.startMs / 1_000,
            range.endMs / 1_000,
            `Reconciled participant: ${participant.name} — ${participant.role}`,
            0.7,
          ),
        ),
    ),
    ...(summary.context ?? []).flatMap((context) =>
      context.evidence
        .slice(0, 1)
        .map((range) =>
          entry(
            range.startMs / 1_000,
            range.endMs / 1_000,
            `Reconciled context: ${context.fact}`,
            0.7,
          ),
        ),
    ),
    ...(summary.sourceItems ?? []).map((item) =>
      entry(
        item.startMs / 1_000,
        item.endMs / 1_000,
        item.kind === 'question'
          ? `Source question (${item.channel}): ${item.text}${
              item.answer ? `\nSource answer: ${item.answer}` : ''
            }`
          : `Source item (${item.kind}, ${item.channel}): ${item.text}`,
        0.82,
      ),
    ),
  ];
}

function normalizeBrief(asset: MediaAsset): Record<string, unknown> {
  const candidate = asset.toolInputs?.['video-intelligence'];
  const input =
    candidate && typeof candidate === 'object' ? (candidate as Record<string, unknown>) : {};
  const rawIndexingMode = String(input.indexingMode);
  const indexingMode = ['fast', 'balanced', 'thorough'].includes(rawIndexingMode)
    ? rawIndexingMode
    : 'balanced';
  return {
    goal: typeof input.goal === 'string' ? input.goal.slice(0, 4_000) : undefined,
    contentType:
      typeof input.contentType === 'string' && input.contentType.trim()
        ? input.contentType.trim().slice(0, 120)
        : 'general',
    knownEntities: stringList(input.knownEntities, 50),
    expectedQuestions: stringList(input.expectedQuestions, 20),
    language:
      typeof input.language === 'string' && input.language.trim() && input.language !== 'auto'
        ? input.language.slice(0, 32)
        : (inferLanguageHintFromTitle(asset.fileName) ?? 'auto'),
    importantRanges: Array.isArray(input.importantRanges) ? input.importantRanges.slice(0, 20) : [],
    indexingMode,
    processingAuthorityConfirmed: input.processingAuthorityConfirmed === true,
    retainSourceHours: retainSourceHours(input.retainSourceHours),
  };
}

/**
 * Infer only languages whose writing system makes the hint high-confidence.
 * Latin titles stay automatic because their script is shared by too many
 * languages. This avoids a second AI request and remains content-agnostic.
 */
export function inferLanguageHintFromTitle(title: string): string | undefined {
  const count = (pattern: RegExp) => title.match(pattern)?.length ?? 0;
  const arabic = count(/\p{Script=Arabic}/gu);
  const cyrillic = count(/\p{Script=Cyrillic}/gu);
  const candidates: Array<[string, number]> = [
    [/[ٹڈڑںھ]/u.test(title) ? 'ur' : /[گچپژ]/u.test(title) ? 'fa' : 'ar', arabic],
    [/[іїєґ]/iu.test(title) ? 'uk' : 'ru', cyrillic],
    ['he', count(/\p{Script=Hebrew}/gu)],
    ['ko', count(/\p{Script=Hangul}/gu)],
    ['ja', count(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu)],
    ['th', count(/\p{Script=Thai}/gu)],
    ['el', count(/\p{Script=Greek}/gu)],
    ['hi', count(/\p{Script=Devanagari}/gu)],
  ];
  const [language, characters] = candidates.sort((left, right) => right[1] - left[1])[0] ?? [];
  return characters >= 3 ? language : undefined;
}

/**
 * A bounded cloud re-analysis (`watch_original` / inspection-policy's
 * required/optional decisions) reseeks the original source video, so it
 * cannot work once the source is deleted. Defaults to 72 hours -- long
 * enough for an active chat session to still verify uncertain evidence,
 * short enough to bound retained-video exposure -- and stays overridable
 * per install, clamped to the runtime brief's [0, 720] schema range.
 */
function retainSourceHours(value: unknown): number {
  const configured = Number(value);
  if (!Number.isFinite(configured)) return 72;
  return Math.max(0, Math.min(720, Math.round(configured)));
}

function stringList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ].slice(0, limit);
}

function mapStage(stage: string): MediaPipelineStage {
  if (stage === 'prepare') return 'prepare';
  if (stage === 'transcribe') return 'transcribe';
  // The worker's final phase is distinct from visual frame analysis. Preserve
  // it so the UI can truthfully say it is finishing rather than implying that
  // it is still selecting frames.
  if (stage === 'synthesize') return 'synthesize';
  if (stage === 'complete') return 'vision';
  if (stage === 'detect' || stage === 'ocr') return 'vision';
  return 'extract';
}

async function completePreviousCloudStage(stage: string, reportStage: ReportStage): Promise<void> {
  if (stage === 'prepare') {
    await reportStage('prepare', {
      status: 'completed',
      percent: 100,
      message: 'Cloud video ready.',
    });
  }
  if (stage === 'transcribe') {
    await reportStage('transcribe', {
      status: 'completed',
      percent: 100,
      message: 'Speech timeline ready.',
    });
  }
  if (stage === 'decode') {
    await reportStage('extract', {
      status: 'completed',
      percent: 100,
      message: 'Video evidence selected.',
    });
  }
}

export function evidenceToSegments(evidence: VideoEvidence): MediaEvidenceSegment[] {
  const buckets = new Map<
    number,
    { speech: string[]; story: string[]; visual: string[]; startSecs: number; endSecs: number }
  >();
  const bucketFor = (seconds: number) => {
    const index = Math.floor(seconds / 30);
    const existing = buckets.get(index);
    if (existing) return existing;
    const created = {
      speech: [] as string[],
      story: [] as string[],
      visual: [] as string[],
      startSecs: index * 30,
      endSecs: Math.min((index + 1) * 30, evidence.durationMs / 1_000),
    };
    buckets.set(index, created);
    return created;
  };
  for (const transcript of evidence.transcript) {
    bucketFor(transcript.startMs / 1_000).speech.push(transcript.text);
  }
  // A detector's class list ("person, chair, couch") and a raw OCR dump say
  // nothing a reader can use, but they are numerous enough to dominate every
  // retrieved excerpt and to be what a user sees when they open the indexed
  // text. Both remain queryable as their own evidence records
  // (`evidenceToKnowledgeInputs`); they just no longer pass for notes. Only
  // confidently-read on-screen text survives here, because an exact label or
  // readout is often the thing a later question turns on.
  for (const observation of evidence.visualObservations) {
    const visibleText = observation.ocr
      .filter((line) => line.confidence >= 0.75 && line.text.trim().length >= 2)
      .map((line) => line.text.trim());
    if (visibleText.length) {
      bucketFor(observation.timeMs / 1_000).visual.push(
        `On screen: ${[...new Set(visibleText)].join(' | ')}`,
      );
    }
  }
  for (const observation of evidence.semanticObservations ?? []) {
    const interpretation = observation.text.trim();
    if (!interpretation) continue;
    const bucket = bucketFor(observation.startMs / 1_000);
    bucket.endSecs = Math.max(
      bucket.endSecs,
      Math.min(evidence.durationMs / 1_000, observation.endMs / 1_000),
    );
    bucket.visual.push(interpretation);
  }
  const summary = evidence.knowledgeSummary;
  if (summary?.overview) bucketFor(0).visual.push(`Indexed overview: ${summary.overview}`);
  for (const participant of summary?.participants ?? []) {
    for (const source of participant.evidence) {
      bucketFor(source.startMs / 1_000).visual.push(
        `Indexed participant: ${participant.name} — ${participant.role}.`,
      );
    }
  }
  for (const state of summary?.stateHistory ?? []) {
    bucketFor(state.startMs / 1_000).visual.push(
      `Indexed state (${state.confidence}): ${state.state}`,
    );
  }
  for (const event of summary?.keyEvents ?? []) {
    bucketFor(event.startMs / 1_000).visual.push(
      `Indexed event (${event.confidence}): ${event.event}`,
    );
  }
  for (const note of summary?.narrative ?? []) {
    bucketFor(note.startMs / 1_000).story.push(note.text);
  }
  for (const context of summary?.context ?? []) {
    for (const source of context.evidence) {
      bucketFor(source.startMs / 1_000).visual.push(`Indexed context: ${context.fact}`);
    }
  }
  for (const item of summary?.sourceItems ?? []) {
    bucketFor(item.startMs / 1_000).visual.push(
      item.kind === 'question'
        ? `Source question (${item.channel}): ${item.text}${
            item.answer ? `\nSource answer: ${item.answer}` : ''
          }`
        : `Source item (${item.kind}, ${item.channel}): ${item.text}`,
    );
  }
  const guide = [
    evidence.answeringGuide.goal ? `User indexing goal: ${evidence.answeringGuide.goal}` : '',
    evidence.answeringGuide.importantEntities.length
      ? `Important entities: ${evidence.answeringGuide.importantEntities.join(', ')}`
      : '',
    evidence.answeringGuide.questionsToPrepareFor.length
      ? `Expected questions: ${evidence.answeringGuide.questionsToPrepareFor.join(' | ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
  return [...buckets.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, bucket], sequence) => {
      const transcript = bucket.speech.join(' ').trim();
      // Lead with the cross-scene account a person would remember; keep raw
      // per-clip readings underneath it as source detail.
      const visualContext = [...new Set([...bucket.story, ...bucket.visual])].join('\n');
      const guidance = sequence === 0 && guide ? `${guide}\n` : '';
      return {
        text: `${guidance}${transcript ? `Speech: ${transcript}\n` : ''}${visualContext}`.trim(),
        transcript,
        visualContext,
        startSecs: bucket.startSecs,
        endSecs: bucket.endSecs,
        sequence,
      };
    })
    .filter((segment) => segment.text.length > 0);
}

/** Render the runtime's already-audited account without paying for a second LLM pass. */
export function formatVideoKnowledgeSummary(evidence: VideoEvidence): string | null {
  const summary = evidence.knowledgeSummary;
  if (!summary?.overview) return null;
  const time = (milliseconds: number) => {
    const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
    const hours = Math.floor(seconds / 3_600);
    const minutes = Math.floor((seconds % 3_600) / 60);
    const remainder = seconds % 60;
    return hours > 0
      ? `${hours}:${minutes.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}`
      : `${minutes}:${remainder.toString().padStart(2, '0')}`;
  };
  const lines = [`Overview: ${summary.overview}`];
  if (summary.participants?.length) {
    lines.push(
      'Participants:',
      ...summary.participants.map((item) => {
        const anchor = item.evidence[0];
        return `- ${anchor ? `[${time(anchor.startMs)}] ` : ''}${item.name}: ${item.role}`;
      }),
    );
  }
  const timeline = [
    ...(summary.stateHistory ?? []).map((item) => ({
      startMs: item.startMs,
      endMs: item.endMs,
      text: item.state,
      kind: 'State',
    })),
    ...(summary.keyEvents ?? []).map((item) => ({
      startMs: item.startMs,
      endMs: item.endMs,
      text: item.event,
      kind: 'Event',
    })),
  ].sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
  if (timeline.length) {
    lines.push(
      'Clean timeline:',
      ...timeline.map(
        (item) => `- [${time(item.startMs)}–${time(item.endMs)}] ${item.kind}: ${item.text}`,
      ),
    );
  }
  if (summary.narrative?.length) {
    lines.push(
      'Story notes:',
      ...summary.narrative.map(
        (item) => `- [${time(item.startMs)}–${time(item.endMs)}] ${item.text}`,
      ),
    );
  }
  if (summary.context?.length) {
    lines.push(
      'Context:',
      ...summary.context.map((item) => {
        const anchor = item.evidence[0];
        return `- ${anchor ? `[${time(anchor.startMs)}] ` : ''}${item.fact}`;
      }),
    );
  }
  if (summary.sourceItems?.length) {
    lines.push(
      'Source inventory:',
      ...summary.sourceItems.map(
        (item) =>
          `- [${time(item.startMs)}–${time(item.endMs)}] ${item.kind}: ${item.text}${
            item.answer ? ` — ${item.answer}` : ''
          }`,
      ),
    );
  }
  if (summary.uncertainties?.length) {
    lines.push('Uncertainties:', ...summary.uncertainties.map((item) => `- ${item}`));
  }
  return lines.join('\n');
}
