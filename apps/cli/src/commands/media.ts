import { promises as fs } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { readConfig } from '@larkup/core/config-store';
import { addDocument } from '@larkup/core/documents-store';
import { readRun } from '@larkup/core/index-store';
import { createRun, runIndexer } from '@larkup/core/indexing/indexer';
import {
  addMediaAssets,
  claimMediaAsset,
  readMediaAssets,
  updateMediaAsset,
} from '@larkup/core/media-store';
import { isToolInstalled } from '@larkup/marketplace/installer';
import { loadTool } from '@larkup/marketplace/loader';
import { createStorageProvider } from '@larkup/marketplace/storage';
import type { MediaAsset, MediaType } from '@larkup/core/types';
import { trackUsageEvent } from '@larkup/core/analytics-store';
import { createVideoKnowledgeRevision } from '@larkup/core/video-knowledge/revision-store';
import {
  claimVideoKnowledgeJob,
  checkpointVideoKnowledgeJob,
  createVideoKnowledgeJob,
  finishVideoKnowledgeJob,
} from '@larkup/core/video-knowledge/job-store';
import {
  buildVideoKnowledgeFromEvidence,
  type OfflineKnowledgeEvidenceInput,
} from '@larkup/core/video-knowledge/knowledge-builder';
import {
  activateVideoKnowledgeManifest,
  saveVideoKnowledgeProjection,
} from '@larkup/core/video-knowledge/manifest-store';
import { collectFiles } from '../lib/local-files';
import { log } from '../ui/logger';
import { prompts } from '../ui/prompts';
import { inServerScope, requireActive } from '../lib/scope';

interface MediaOptions {
  index?: boolean;
  server?: string;
}

interface MediaTool {
  processAudio?: (filePath: string, options: Record<string, unknown>) => Promise<Transcript>;
  processVideo?: (
    filePath: string,
    options: Record<string, unknown>,
  ) => Promise<{ audioPath?: string; frames: unknown[]; meta: VideoMeta }>;
  buildMultimodalSegments?: (
    transcript: TranscriptChunk[],
    visuals: never[],
    durationSecs: number,
    windowSecs: number,
  ) => TimelineSegment[];
}

interface TranscriptChunk {
  text: string;
  startSecs: number;
  endSecs: number;
}

interface Transcript {
  chunks: TranscriptChunk[];
  durationSecs: number;
}

interface VideoMeta {
  durationSecs: number;
  width: number;
  height: number;
}

interface TimelineSegment {
  text: string;
  startSecs: number;
  endSecs: number;
}

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
};

async function processMediaCommand(inputs: string[], options: MediaOptions) {
  await requireActive();
  if (inputs.length === 0) {
    const assets = await readMediaAssets();
    if (assets.length === 0) {
      log.dim('No media assets yet. Add one with: larkup media ./recording.mp3');
      return;
    }
    for (const asset of assets) {
      const progress =
        asset.processingProgress === undefined ? '' : ` ${asset.processingProgress}%`;
      log.info(
        `${asset.id}  ${asset.fileName}  ${asset.type}  ${asset.processingStatus}${progress}`,
      );
    }
    return;
  }

  const files = await collectFiles(inputs);
  const mediaFiles = files.filter((filePath) => Boolean(mediaType(filePath)));
  if (mediaFiles.length === 0) {
    log.error('No supported image, audio, or video files were found.');
  }

  const storage = createStorageProvider();
  const assets = await Promise.all(
    mediaFiles.map(async (filePath) => {
      const type = mediaType(filePath)!;
      const stat = await fs.stat(filePath);
      const extension = path.extname(filePath).toLowerCase() || '.bin';
      const key = `${type}s/${Date.now()}_${Math.random().toString(36).slice(2)}${extension}`;
      const mimeType = MIME_TYPES[extension] || 'application/octet-stream';
      const storageUri = storage.storeFile
        ? await storage.storeFile(key, filePath, mimeType)
        : await storage.store(key, await fs.readFile(filePath), mimeType);
      return { type, fileName: path.basename(filePath), mimeType, storageUri, fileSize: stat.size };
    }),
  );

  const stored = await addMediaAssets(assets);
  log.success(`Added ${stored.length} media asset${stored.length === 1 ? '' : 's'}.`);

  for (const asset of stored) {
    await processMediaAsset(asset);
  }

  if (options.index !== false) await indexPendingMedia();
}

export async function mediaCommand(inputs: string[], options: MediaOptions = {}) {
  await inServerScope(options.server, () => processMediaCommand(inputs, options));
}

async function processMediaAsset(asset: MediaAsset) {
  const claimed = await claimMediaAsset(asset.id);
  if (!claimed) return;

  const spinner = prompts.spinner();
  const update = async (message: string, progress: number) => {
    spinner.message(`${claimed.fileName}: ${message}`);
    await updateMediaAsset(claimed.id, {
      processingStatus: 'processing',
      processingMessage: message,
      processingProgress: progress,
    });
  };

  spinner.start(`${claimed.fileName}: preparing`);
  try {
    await update('Preparing media', 5);
    if (claimed.type === 'image') {
      const document = await addDocument({
        title: claimed.fileName,
        content: `Image asset: ${claimed.fileName}`,
        source: 'media',
        metadata: {
          mediaAssetId: claimed.id,
          mediaType: 'image',
          fileName: claimed.fileName,
          mimeType: claimed.mimeType,
          fileSize: claimed.fileSize,
        },
      });
      await updateMediaAsset(claimed.id, {
        processingStatus: 'completed',
        processingProgress: 100,
        processingMessage: undefined,
        caption: `Image: ${claimed.fileName}`,
        documentIds: [document.id],
      });
      spinner.stop(`${claimed.fileName}: ready to index`);
      return;
    }

    if (!(await isToolInstalled('video-audio'))) {
      throw new Error(
        'Video & Audio is not installed. Run: larkup marketplace install video-audio',
      );
    }

    const tool = await loadTool<MediaTool>('video-audio');
    if (!tool?.processAudio || !tool.buildMultimodalSegments) {
      throw new Error('The Video & Audio tool is unavailable. Reinstall it and try again.');
    }

    const config = await readConfig();
    const toolConfig = config.toolConfigs?.['video-audio'] || {};
    const provider = typeof toolConfig.audioProvider === 'string' ? toolConfig.audioProvider : '';
    const apiKey = typeof toolConfig.audioApiKey === 'string' ? toolConfig.audioApiKey : '';
    const language =
      typeof toolConfig.audioLanguage === 'string' ? toolConfig.audioLanguage : 'auto';
    if (!provider || (provider !== 'local' && !apiKey)) {
      throw new Error(
        'Configure the Video & Audio transcription provider and API key in Marketplace Tools.',
      );
    }

    const storage = createStorageProvider();
    const localFile = await storage.resolvePath?.(claimed.storageUri);
    if (!localFile)
      throw new Error('The configured storage provider cannot expose a local media path.');

    let transcript: Transcript;
    let durationSecs: number;
    let dimensions: { width: number; height: number } | undefined;
    let frameCount = 0;

    if (claimed.type === 'video') {
      if (!tool.processVideo)
        throw new Error('The installed Video & Audio tool cannot process videos.');
      await update('Extracting video audio', 20);
      const outputDir = await fs.mkdtemp(path.join(process.cwd(), '.larkup', 'tmp-media-'));
      try {
        const video = await tool.processVideo(localFile, {
          outputDir,
          frameIntervalSecs: 30,
          maxFrames: 1,
          parallelExtraction: true,
          onProgress: (value: number) =>
            void update('Extracting video audio', 20 + Math.round(value * 35)),
        });
        if (!video.audioPath) throw new Error('No audio track was found in the video.');
        await update(`Transcribing with ${provider}`, 60);
        transcript = await tool.processAudio(video.audioPath, {
          provider,
          apiKey,
          language,
          context: claimed.fileName,
        });
        durationSecs = video.meta.durationSecs;
        dimensions = { width: video.meta.width, height: video.meta.height };
        frameCount = video.frames.length;
      } finally {
        await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
      }
    } else {
      await update(`Transcribing with ${provider}`, 25);
      transcript = await tool.processAudio(localFile, {
        provider,
        apiKey,
        language,
        context: claimed.fileName,
      });
      durationSecs = transcript.durationSecs;
    }

    const segments = tool.buildMultimodalSegments(transcript.chunks, [], durationSecs, 60);
    if (segments.length === 0)
      throw new Error('The transcription did not produce searchable speech.');

    await update('Saving searchable timeline', 82);
    const document = await addDocument({
      title: claimed.fileName,
      content: timeline(claimed.type === 'video' ? 'Video' : 'Audio', claimed.fileName, segments),
      source: 'media',
      metadata: {
        mediaAssetId: claimed.id,
        mediaType: claimed.type,
        fileName: claimed.fileName,
        mimeType: claimed.mimeType,
        fileSize: claimed.fileSize,
        durationSecs,
        frameCount,
        contentKind: claimed.type === 'video' ? 'video-transcript' : 'audio-transcript',
      },
    });

    const knowledge = await publishCliVideoKnowledge({
      asset: claimed,
      localFile,
      durationSecs,
      frameCount,
      documentId: document.id,
      segments,
    });

    await updateMediaAsset(claimed.id, {
      processingStatus: 'completed',
      processingProgress: 100,
      processingMessage: undefined,
      caption: `${claimed.type === 'video' ? 'Video' : 'Audio'}: ${Math.round(durationSecs)}s`,
      durationSecs,
      dimensions,
      documentIds: [document.id],
      activeVideoKnowledgeRevisionId: knowledge.revisionId,
      activeVideoKnowledgeManifestId: knowledge.manifestId,
    });
    void trackUsageEvent({
      type: 'media_processing',
      mediaType: claimed.type,
      modelId: provider,
      durationSecs,
      frameCount,
      timestamp: new Date().toISOString(),
    });
    spinner.stop(`${claimed.fileName}: ready to index`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateMediaAsset(claimed.id, {
      processingStatus: 'failed',
      processingError: message,
      processingMessage: undefined,
      processingProgress: undefined,
    });
    spinner.stop(`${claimed.fileName}: failed`);
    log.warn(message);
  }
}

async function publishCliVideoKnowledge(input: {
  asset: MediaAsset;
  localFile: string;
  durationSecs: number;
  frameCount: number;
  documentId: string;
  segments: TimelineSegment[];
}) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(input.localFile)) hash.update(chunk);
  const revision = await createVideoKnowledgeRevision({
    mediaAssetId: input.asset.id,
    sourceFingerprint: hash.digest('hex'),
    pipelineVersion: 'video-knowledge-v1',
    budget: {
      maxDurationSecs: input.durationSecs,
      maxBytes: input.asset.fileSize,
      maxFrames: input.frameCount,
      maxModelCalls: 0,
      maxCostUsd: 0,
      usedDurationSecs: input.durationSecs,
      usedFrames: input.frameCount,
    },
    coverage: {
      sourceDurationSecs: input.durationSecs,
      inspectedRanges: [],
      transcriptCoverage: 0,
      visualCoverage: 0,
      ocrCoverage: 0,
      partialReasons: [],
    },
  });
  const job = await createVideoKnowledgeJob({
    mediaAssetId: input.asset.id,
    knowledgeRevisionId: revision.id,
    idempotencyKey: `${input.asset.id}:${revision.sourceFingerprint}:video-knowledge-v1`,
    budget: revision.budget,
  });
  const owner = randomUUID();
  if (!(await claimVideoKnowledgeJob(job.id, owner)))
    throw new Error('Unable to claim CLI video knowledge job.');
  try {
    const confidence = {
      score: 0.8,
      source: 'provider' as const,
      calibrationStatus: 'uncalibrated' as const,
      uncertaintyReasons: ['CLI transcription has provider-segment timestamp precision.'],
    };
    const evidence: OfflineKnowledgeEvidenceInput[] = [
      ...input.segments
        .filter((segment) => segment.text.trim())
        .map((segment) => ({
          modality: 'transcript' as const,
          timeRange: {
            startSecs: segment.startSecs,
            endSecs: segment.endSecs,
            precision: 'segment' as const,
          },
          payload: { text: segment.text },
          source: { kind: 'provider' as const, provider: 'stt' },
          confidence,
          observation: { kind: 'speech' as const, value: { text: segment.text } },
        })),
      ...deriveCliAudioSignals(input.segments).map((signal) => ({
        modality: 'audio-event' as const,
        timeRange: {
          startSecs: signal.timestampSecs,
          endSecs: signal.timestampSecs,
          precision: 'segment' as const,
        },
        payload: {
          transcriptChange: signal.transcriptChange,
          silenceBoundary: signal.silenceBoundary,
        },
        source: { kind: 'heuristic' as const, version: 'audio-signals-v1' },
        confidence: { ...confidence, source: 'heuristic' as const },
        observation: {
          kind: 'audio-event' as const,
          value: {
            transcriptChange: signal.transcriptChange,
            silenceBoundary: signal.silenceBoundary,
          },
        },
      })),
    ];
    const built = await buildVideoKnowledgeFromEvidence({
      mediaAssetId: input.asset.id,
      knowledgeRevisionId: revision.id,
      evidence,
    });
    const projection = await saveVideoKnowledgeProjection({
      mediaAssetId: input.asset.id,
      knowledgeRevisionId: revision.id,
      kind: 'transcript',
      documentId: input.documentId,
      lineageIds: [],
      evidenceIds: built.evidenceIds,
      quality: {
        score: 0.7,
        source: 'heuristic',
        calibrationStatus: 'uncalibrated',
        uncertaintyReasons: ['Search projection; source evidence is authoritative.'],
      },
      active: false,
    });
    await checkpointVideoKnowledgeJob(job.id, owner, 'projecting', {
      completedEvidenceIds: built.evidenceIds,
      completedProjectionIds: [projection.id],
    });
    const manifest = await activateVideoKnowledgeManifest({
      mediaAssetId: input.asset.id,
      knowledgeRevisionId: revision.id,
      activeEvidenceRevisionIds: Object.fromEntries(
        built.evidenceLineageIds.map((lineageId, index) => [lineageId, built.evidenceIds[index]]),
      ),
      activeObservationRevisionIds: Object.fromEntries(
        built.observationLineageIds.map((lineageId, index) => [
          lineageId,
          built.observationIds[index],
        ]),
      ),
      activeProjectionIds: [projection.id],
      activationReason: 'initial',
    });
    await finishVideoKnowledgeJob(job.id, owner, 'completed');
    return { revisionId: revision.id, manifestId: manifest.id };
  } catch (error) {
    await finishVideoKnowledgeJob(
      job.id,
      owner,
      'failed',
      error instanceof Error ? error.message : 'CLI knowledge publication failed.',
    );
    throw error;
  }
}

async function indexPendingMedia() {
  const config = await readConfig();
  const previousRun = await readRun();
  const run = await createRun(config);
  const spinner = prompts.spinner();
  spinner.start('Indexing processed media');
  await runIndexer(run.id, config, previousRun?.status === 'completed' ? previousRun : null);
  const finalRun = await readRun();
  if (finalRun?.status !== 'completed') {
    spinner.stop('Media indexing failed');
    log.warn(finalRun?.error || 'Media indexing did not complete.');
    return;
  }
  spinner.stop(`Indexed ${finalRun.totalChunks} chunks`);
}

function mediaType(filePath: string): MediaType | undefined {
  const extension = path.extname(filePath).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(extension)) return 'image';
  if (['.mp4', '.webm', '.mov', '.mkv'].includes(extension)) return 'video';
  if (['.mp3', '.m4a', '.wav', '.ogg', '.flac'].includes(extension)) return 'audio';
  return undefined;
}

function timeline(label: 'Audio' | 'Video', fileName: string, segments: TimelineSegment[]) {
  return [
    `${label}: ${fileName}`,
    ...segments.map(
      (segment) =>
        `## ${formatTime(segment.startSecs)} – ${formatTime(segment.endSecs)}\n${segment.text}`,
    ),
  ].join('\n\n');
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

function deriveCliAudioSignals(
  chunks: Array<{ text: string; startSecs: number; endSecs: number }>,
) {
  let previous: { text: string; startSecs: number; endSecs: number } | undefined;
  return [...chunks]
    .sort((left, right) => left.startSecs - right.startSecs)
    .map((chunk) => {
      const earlier = new Set(
        (previous?.text ?? '').toLocaleLowerCase().match(/[\p{Letter}\p{Number}]+/gu) ?? [],
      );
      const words = new Set(
        chunk.text.toLocaleLowerCase().match(/[\p{Letter}\p{Number}]+/gu) ?? [],
      );
      const transcriptChange =
        words.size === 0 ? 0 : [...words].filter((word) => !earlier.has(word)).length / words.size;
      const signal = {
        timestampSecs: chunk.startSecs,
        transcriptChange,
        silenceBoundary: Boolean(previous && chunk.startSecs - previous.endSecs >= 2),
      };
      previous = chunk;
      return signal;
    });
}
