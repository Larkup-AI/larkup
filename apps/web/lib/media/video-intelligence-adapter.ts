import { openAsBlob } from 'node:fs';
import { getInstalledTool } from '@larkup/marketplace/installer';
import { loadToolExtension } from '@larkup/marketplace/extension';
import { readConfig } from '@larkup/core/config-store';
import type { MediaAsset, MediaPipelineStage } from '@larkup/core/types';
import type { MediaEvidenceSegment } from './knowledge';

interface VideoClient {
  upload(file: Blob, fileName: string): Promise<{ uploadId: string }>;
  submitJob(request: Record<string, unknown>): Promise<VideoJob>;
  getJob(jobId: string): Promise<VideoJob>;
  cancelJob(jobId: string): Promise<VideoJob>;
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
  }>;
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
}): Promise<{
  evidence: VideoEvidence;
  segments: MediaEvidenceSegment[];
}> {
  const installed = await getInstalledTool('video-intelligence');
  if (!installed) throw new Error('Install Video Intelligence (New) before indexing this video.');
  const extension = await loadToolExtension<VideoClient>('video-intelligence');
  if (!extension) throw new Error('The installed Video Intelligence tool could not be loaded.');
  const globalConfig = await readConfig();
  const config = {
    ...installed.config,
    ...(globalConfig.toolConfigs?.['video-intelligence'] ?? {}),
  };
  const context = { config, fetch: globalThis.fetch };
  await input.reportStage('extract', {
    status: 'running',
    percent: 1,
    message: 'Starting the selected Video Intelligence runtime...',
  });
  await extension.ensureRuntime?.(context);
  const client = extension.createClient(context);
  const file = await openAsBlob(input.mediaPath, { type: input.asset.mimeType });
  const uploaded = await client.upload(file, input.asset.fileName);
  const brief = normalizeBrief(input.asset);
  let job = await client.submitJob({
    source: {
      uploadId: uploaded.uploadId,
      fileName: input.asset.fileName,
      mimeType: input.asset.mimeType,
      durationSecs: input.asset.durationSecs,
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
