import { openAsBlob } from 'node:fs';
import { getInstalledTool } from '@larkup/marketplace/installer';
import { loadToolExtension } from '@larkup/marketplace/extension';
import type { MediaAsset, MediaPipelineStage } from '@larkup/core/types';
import { processAudio } from '@larkup/tool-video-audio';
import type { OfflineKnowledgeEvidenceInput } from '@larkup/core/video-knowledge/knowledge-builder';
import type { MediaEvidenceSegment } from './knowledge';
import { resolveVideoIntelligenceConnection } from './video-intelligence-connection';

interface VideoClient {
  health(): Promise<unknown>;
  getUsage(): Promise<{ sourceMinutesLimit: number | null }>;
  provisionDeviceAccess(installationId: string): Promise<{
    apiKey: string;
    entitlement: {
      plan: string;
      sourceMinutesPerMonth: number | null;
      maxConcurrentJobs: number;
      allowFullCoverage: boolean;
    };
  }>;
  upload(file: Blob, fileName: string): Promise<{ uploadId: string }>;
  submitJob(request: Record<string, unknown>): Promise<VideoJob>;
  getJob(jobId: string): Promise<VideoJob>;
  cancelJob(jobId: string): Promise<VideoJob>;
}

/**
 * The inspection policy has its own conservative interactive budget. A cloud
 * entitlement with no source-minute cap has already been authorized by the
 * control plane, so it may proceed without an extra browser approval prompt.
 */
export async function hasUnlimitedVideoIntelligenceAccess(): Promise<boolean> {
  const installed = await getInstalledTool('video-intelligence');
  if (!installed) return false;
  const extension = await loadToolExtension<VideoClient>('video-intelligence');
  if (!extension) return false;
  const { config } = await resolveVideoIntelligenceConnection(extension, installed.config);
  const client = extension.createClient({ config, fetch: globalThis.fetch });
  return (await client.getUsage()).sourceMinutesLimit === null;
}

interface VideoJob {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: { stage: string; percent: number; message: string };
  result: VideoEvidence | null;
  error: string | null;
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
  scoreboardStates?: Array<{ timeMs: number; score: string; confidence: number }>;
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
  detectedLanguage?: string;
  answeringGuide: {
    goal?: string;
    importantEntities: string[];
    questionsToPrepareFor: string[];
    instruction: string;
  };
}

type ReportStage = (
  stage: MediaPipelineStage,
  patch: { status: 'running' | 'completed'; percent?: number; message: string },
) => Promise<void>;

export async function runInstalledVideoIntelligence(input: {
  asset: MediaAsset;
  mediaPath: string;
  reportStage: ReportStage;
  briefOverride?: Record<string, unknown>;
  /** Bounded cloud inspection reserves only the requested source range. */
  sourceDurationSecs?: number;
}): Promise<{
  evidence: VideoEvidence;
  segments: MediaEvidenceSegment[];
}> {
  const installed = await getInstalledTool('video-intelligence');
  if (!installed) throw new Error('Install Video Intelligence (New) before indexing this video.');
  const extension = await loadToolExtension<VideoClient>('video-intelligence');
  if (!extension) throw new Error('The installed Video Intelligence tool could not be loaded.');
  const { config } = await resolveVideoIntelligenceConnection(extension, installed.config);
  const context = { config, fetch: globalThis.fetch };
  await input.reportStage('extract', {
    status: 'running',
    percent: 1,
    message: 'Connecting to the managed Video Intelligence GPU service...',
  });
  const client = extension.createClient(context);
  // Video Intelligence is cloud-only in the product. Do not delegate runtime
  // startup to an older installed extension: it may start a local Docker
  // worker, which violates the local-media/remote-compute boundary.
  await client.health();
  const externalAudio = await transcribeWithSelectedProvider(input, config);
  const file = await openAsBlob(input.mediaPath, { type: input.asset.mimeType });
  const uploaded = await client.upload(file, input.asset.fileName);
  const brief = {
    ...normalizeBrief(input.asset),
    ...(input.briefOverride ?? {}),
    ...(externalAudio ? { skipTranscription: true } : {}),
  };
  let job = await client.submitJob({
    source: {
      uploadId: uploaded.uploadId,
      fileName: input.asset.fileName,
      mimeType: input.asset.mimeType,
      durationSecs: input.sourceDurationSecs ?? input.asset.durationSecs,
    },
    brief,
  });
  const deadline = Date.now() + 6 * 60 * 60_000;
  while (job.status === 'queued' || job.status === 'running') {
    if (Date.now() >= deadline) {
      await client.cancelJob(job.id).catch(() => undefined);
      throw new Error('Video indexing exceeded the six-hour safety timeout.');
    }
    await input.reportStage(mapStage(job.progress.stage), {
      status: 'running',
      percent: job.progress.percent,
      message: job.progress.message,
    });
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    job = await client.getJob(job.id);
  }
  if (job.status !== 'completed' || !job.result) {
    throw new Error(job.error || `Video indexing ended with status ${job.status}.`);
  }
  if (externalAudio) {
    job.result.transcript = externalAudio.chunks.map((chunk) => ({
      startMs: Math.round(chunk.startSecs * 1_000),
      endMs: Math.round(chunk.endSecs * 1_000),
      text: chunk.text,
    }));
    job.result.detectedLanguage = externalAudio.language ?? job.result.detectedLanguage;
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
  return { evidence: job.result, segments: evidenceToSegments(job.result) };
}

async function transcribeWithSelectedProvider(
  input: Pick<
    Parameters<typeof runInstalledVideoIntelligence>[0],
    'asset' | 'mediaPath' | 'reportStage'
  >,
  config: Record<string, unknown>,
) {
  const provider = typeof config.audioProvider === 'string' ? config.audioProvider : 'larkup-cloud';
  if (provider === 'larkup-cloud') return null;
  const apiKey = typeof config.audioApiKey === 'string' ? config.audioApiKey.trim() : '';
  if (!apiKey) {
    throw new Error(`Add and verify an API key for ${provider} in Video Intelligence settings.`);
  }
  const supportedProvider = new Set(['openai', 'groq', 'deepgram', 'elevenlabs']);
  if (!supportedProvider.has(provider)) {
    throw new Error(`Audio provider ${provider} is not supported for Video Intelligence.`);
  }
  return processAudio(input.mediaPath, {
    provider,
    apiKey,
    language: 'auto',
    context: input.asset.fileName,
    onProgress: async (current, total, message) => {
      await input.reportStage('transcribe', {
        status: 'running',
        percent: total ? Math.round((current / total) * 100) : 0,
        message,
      });
    },
  });
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
    ...(evidence.scoreboardStates ?? []).map((state) => ({
      startSecs: state.timeMs / 1_000,
      endSecs: state.timeMs / 1_000,
      observations: [
        {
          kind: 'state' as const,
          value: JSON.stringify({ subject: 'scoreboard', property: 'score', value: state.score }),
          frameTimestamps: [state.timeMs / 1_000],
          confidence: state.confidence,
          uncertaintyReasons: [
            'Score candidate extracted from OCR; verify it against adjacent evidence before answering.',
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
  return [...transcript, ...visual, ...inputs.ocrEvidence, ...tracking];
}

function normalizeBrief(asset: MediaAsset): Record<string, unknown> {
  const candidate = asset.toolInputs?.['video-intelligence'];
  const input =
    candidate && typeof candidate === 'object' ? (candidate as Record<string, unknown>) : {};
  const indexingMode = ['fast', 'balanced', 'deep', 'full-coverage'].includes(
    String(input.indexingMode),
  )
    ? String(input.indexingMode)
    : 'balanced';
  return {
    goal: typeof input.goal === 'string' ? input.goal.slice(0, 4_000) : undefined,
    contentType: ['general', 'course', 'sports', 'surveillance', 'meeting'].includes(
      String(input.contentType),
    )
      ? input.contentType
      : 'general',
    knownEntities: stringList(input.knownEntities, 50),
    expectedQuestions: stringList(input.expectedQuestions, 20),
    language: typeof input.language === 'string' ? input.language.slice(0, 32) : 'auto',
    importantRanges: Array.isArray(input.importantRanges) ? input.importantRanges.slice(0, 20) : [],
    indexingMode,
    processingAuthorityConfirmed:
      indexingMode !== 'full-coverage' || input.processingAuthorityConfirmed === true,
    retainSourceHours: 0,
  };
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
  if (stage === 'transcribe') return 'transcribe';
  if (stage === 'synthesize' || stage === 'complete') return 'synthesize';
  if (stage === 'detect' || stage === 'ocr') return 'vision';
  return 'extract';
}

function evidenceToSegments(evidence: VideoEvidence): MediaEvidenceSegment[] {
  const buckets = new Map<
    number,
    { speech: string[]; visual: string[]; startSecs: number; endSecs: number }
  >();
  const bucketFor = (seconds: number) => {
    const index = Math.floor(seconds / 30);
    const existing = buckets.get(index);
    if (existing) return existing;
    const created = {
      speech: [] as string[],
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
  for (const observation of evidence.visualObservations) {
    const bucket = bucketFor(observation.timeMs / 1_000);
    const labels = [...new Set(observation.objects.map((object) => object.label))];
    const visibleText = observation.ocr
      .filter((line) => line.confidence >= 0.45)
      .map((line) => line.text);
    if (labels.length) bucket.visual.push(`Visible objects: ${labels.join(', ')}.`);
    if (visibleText.length) bucket.visual.push(`Visible text: ${visibleText.join(' | ')}`);
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
      const visualContext = [...new Set(bucket.visual)].join('\n');
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
