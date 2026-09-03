import { NextResponse } from 'next/server';
import { createHash, randomUUID } from 'node:crypto';
import {
  claimMediaAsset,
  recoverStaleMediaAssets,
  updateMediaAsset,
  updateMediaStage,
  readMediaAssets,
  type MediaProcessingStepPatch,
} from '@larkup/core/media-store';
import { addDocument, addDocuments, deleteDocuments } from '@larkup/core/documents-store';
import { getInstalledTool, isToolInstalled } from '@larkup/marketplace/installer';
import { loadTool } from '@larkup/marketplace/loader';
import { createStorageProvider } from '@larkup/marketplace/storage';
import { readConfig } from '@larkup/core/config-store';
import { trackUsageEvent } from '@larkup/core/analytics-store';
import type { MediaAsset, MediaPipelineStage } from '@larkup/core/types';
import { runWithProject } from '@larkup/core/project-store';
import {
  createVideoKnowledgeRevision,
  findVideoKnowledgeRevision,
  updateVideoKnowledgeRevision,
} from '@larkup/core/video-knowledge/revision-store';
import {
  checkpointVideoKnowledgeJob,
  createVideoKnowledgeJob,
  finishVideoKnowledgeJob,
  getVideoKnowledgeJob,
  recoverStaleVideoKnowledgeJobs,
} from '@larkup/core/video-knowledge/job-store';
import {
  buildVideoKnowledgeFromEvidence,
  type OfflineKnowledgeEvidenceInput,
} from '@larkup/core/video-knowledge/knowledge-builder';
import type { MetadataValue } from '@larkup/core/video-knowledge/types';
import { primeSemanticEvidenceIndex } from '@larkup/core/video-knowledge/evidence-semantic-index';
import {
  activateVideoKnowledgeManifest,
  saveVideoKnowledgeProjections,
} from '@larkup/core/video-knowledge/manifest-store';
import { appendFrameArtifact } from '@larkup/core/video-knowledge/evidence-store';
import { upsertVideoEmbeddings } from '@larkup/core/video-knowledge/video-embedding-index';
import { getConcurrencyLimits } from '@/lib/media/concurrency';
import {
  buildMediaDocumentInputs,
  createFallbackMediaSummary,
  createMediaKnowledgeSummary,
  formatTime,
  type MediaEvidenceSegment,
} from '@/lib/media/knowledge';
import {
  createConfiguredOcrAdapter,
  createConfiguredVisionAdapter,
} from '@/lib/media/video/model-adapters';
import { startLeasedVideoKnowledgeJob } from '@/lib/media/video/worker';
import {
  evidenceToKnowledgeInputs,
  formatVideoKnowledgeSummary,
  getReconciledVideoIntelligenceUsage,
  runInstalledVideoIntelligence,
  validateVideoIntelligenceConfiguration,
} from '@/lib/media/video-intelligence-adapter';
import {
  createArtifactCacheKey,
  deriveAudioSignals,
  extractRunningState,
  importMediaUrl,
  probeMedia,
} from '@/lib/media/source-utils';
import { videoRuntimeScopeFromConfig } from '@/lib/media/video-runtime-scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let mediaProcessingChain: Promise<void> = Promise.resolve();

type StageReporter = (stage: MediaPipelineStage, patch: MediaProcessingStepPatch) => Promise<void>;

/**
 * POST → trigger media processing for one or more assets.
 *
 * Body: { assetIds: string[], serverId?: string, toolInputs?: object }
 *
 * Processing is claimed atomically and continues in the background while the
 * client polls persisted asset progress.
 * For images: generates captions via vision LLM.
 * For video/audio: requires the Video & Audio tool to be installed.
 */
export async function POST(req: Request) {
  try {
    const { assetIds, serverId, action, assetId, toolInputs } = (await req.json()) as {
      assetIds: string[];
      serverId?: string;
      action?: 'pause' | 'resume';
      assetId?: string;
      toolInputs?: Record<string, unknown>;
    };
    if (action && assetId) {
      const update = async () => {
        const asset = await updateMediaAsset(assetId, {
          processingPaused: action === 'pause',
          processingMessage:
            action === 'pause'
              ? 'Paused — resume when you are ready.'
              : 'Resuming media indexing...',
        });
        if (!asset) return NextResponse.json({ error: 'Media asset not found.' }, { status: 404 });
        return NextResponse.json({ asset });
      };
      return serverId ? await runWithProject(serverId, update) : await update();
    }
    if (!assetIds?.length) {
      return NextResponse.json({ error: 'assetIds required' }, { status: 400 });
    }
    const enqueue = () => enqueueMediaProcessing(req.url, assetIds, serverId, toolInputs);
    return serverId ? await runWithProject(serverId, enqueue) : await enqueue();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to trigger processing';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function enqueueMediaProcessing(
  reqUrl: string,
  assetIds: string[],
  serverId?: string,
  toolInputs?: Record<string, unknown>,
): Promise<NextResponse> {
  try {
    const config = await readConfig();
    if (config.embeddingProvider !== 'custom' && !config.embeddingApiKey?.trim()) {
      return NextResponse.json(
        { error: 'Configure an embedding provider API key before adding data.' },
        { status: 409 },
      );
    }
    // A process restart can leave a leased job behind. Recover its durable
    // checkpoint before accepting more work; a new worker may then claim it.
    await Promise.all([recoverStaleVideoKnowledgeJobs(), recoverStaleMediaAssets()]);
    const assets = await readMediaAssets();
    const matchingAssets = assets.filter((asset) => assetIds.includes(asset.id));
    if (
      matchingAssets.some((asset) => asset.type === 'video') &&
      (await isToolInstalled('video-intelligence'))
    ) {
      await validateVideoIntelligenceConfiguration();
    }
    if (matchingAssets.some((asset) => asset.type === 'video')) {
      const usage = await getReconciledVideoIntelligenceUsage(assets);
      const limit = Math.max(1, usage.concurrentJobsLimit || 1);
      if (usage.activeJobs >= limit) {
        throw new Error(
          `A video is already being indexed. Your plan allows ${limit} video indexing job${
            limit === 1 ? '' : 's'
          } at a time. Stop the current video or wait for it to finish.`,
        );
      }
    }
    const configuredAssets = toolInputs
      ? await Promise.all(
          matchingAssets.map((asset) =>
            updateMediaAsset(asset.id, {
              toolInputs: { ...(asset.toolInputs ?? {}), ...toolInputs },
            }),
          ),
        )
      : matchingAssets;
    const claimedAssets = await Promise.all(
      configuredAssets
        .filter((asset): asset is MediaAsset => Boolean(asset))
        .map((asset) => claimMediaAsset(asset.id)),
    );
    const toProcess = claimedAssets.filter((asset): asset is MediaAsset => Boolean(asset));
    const sourceTranscripts = new Map<string, any>();
    const queuedAssetIds = new Set(toProcess.map((asset) => asset.id));

    if (toProcess.length === 0) {
      return NextResponse.json(
        {
          error: matchingAssets.length
            ? 'Media is already processing.'
            : 'No matching assets found',
        },
        { status: matchingAssets.length ? 409 : 404 },
      );
    }

    const touchQueuedAssets = async () => {
      const processingHeartbeatAt = new Date().toISOString();
      await Promise.all(
        [...queuedAssetIds].map((id) =>
          updateMediaAsset(id, { processingHeartbeatAt }).catch(() => undefined),
        ),
      );
    };
    const queuedHeartbeat = setInterval(() => {
      const touch = () => touchQueuedAssets();
      void (serverId ? runWithProject(serverId, touch) : touch()).catch(() => {});
    }, 60_000);

    const runJob = async () => {
      for (const initialAsset of toProcess) {
        queuedAssetIds.delete(initialAsset.id);
        let currentAsset = initialAsset;
        let heartbeat: ReturnType<typeof setInterval> | undefined;
        const activeStages = new Set<MediaPipelineStage>();
        const lastStageUpdates = new Map<MediaPipelineStage, number>();
        const waitUntilResumed = async () => {
          while (true) {
            const latest = (await readMediaAssets()).find((asset) => asset.id === currentAsset.id);
            if (!latest) throw new Error('Media asset was deleted during processing');
            if (!latest.processingPaused) {
              currentAsset = latest;
              return;
            }
            await updateMediaAsset(currentAsset.id, {
              processingHeartbeatAt: new Date().toISOString(),
              processingMessage: 'Paused — resume when you are ready.',
            });
            await new Promise((resolve) => setTimeout(resolve, 750));
          }
        };
        const reportStage: StageReporter = async (stage, patch) => {
          await waitUntilResumed();
          const now = Date.now();
          const isTerminal =
            patch.status === 'completed' || patch.status === 'skipped' || patch.status === 'failed';

          if (
            !isTerminal &&
            patch.status === 'running' &&
            now - (lastStageUpdates.get(stage) ?? 0) < 600
          ) {
            return;
          }
          lastStageUpdates.set(stage, now);
          if (patch.status === 'running') activeStages.add(stage);
          if (isTerminal) activeStages.delete(stage);
          const updated = await updateMediaStage(currentAsset.id, stage, patch);
          if (!updated) {
            throw new Error('Media asset was deleted during processing');
          }
        };

        try {
          await waitUntilResumed();
          const startedAsset = await updateMediaAsset(currentAsset.id, {
            processingStatus: 'processing',
            processingError: undefined,
            processingMessage: 'Starting process...',
            processingProgress: 0,
          });
          if (!startedAsset) {
            throw new Error('Media asset was removed before processing started.');
          }
          currentAsset = startedAsset;
          heartbeat = setInterval(() => {
            void updateMediaAsset(currentAsset.id, {
              processingHeartbeatAt: new Date().toISOString(),
            }).catch(() => {});
          }, 60_000);

          if (currentAsset.storageUri.startsWith('pending://') && currentAsset.originalUrl) {
            await reportStage('download', {
              status: 'running',
              percent: 0,
              message: 'Downloading media from URL...',
            });
            const { addMediaAssets } = await import('@larkup/core/media-store');
            // URL fetching is a built-in compatibility utility. Video indexing itself
            // is performed by Video Intelligence below and never needs audio-provider setup.
            const { promises: fs } = await import('node:fs');
            const path = await import('node:path');
            const os = await import('node:os');
            const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'larkup-url-media-'));
            try {
              const entries = await importMediaUrl(currentAsset.originalUrl, {
                outputDir: tmpDir,
                playlistMax: 10, // max items
                onProgress: ({
                  percent,
                  current,
                  total,
                  unit,
                  elapsedSeconds,
                  estimatedRemainingSeconds,
                  message,
                }) => {
                  void reportStage('download', {
                    status: 'running',
                    percent,
                    current,
                    total,
                    unit,
                    elapsedSeconds,
                    estimatedRemainingSeconds,
                    message,
                  });
                },
              });

              if (!entries || entries.length === 0) {
                throw new Error('No supported media found at the provided URL.');
              }

              const storage = createStorageProvider();

              const storeDownloadedFile = async (
                filePath: string,
                key: string,
                mimeType: string,
              ) => {
                const stat = await fs.stat(filePath);
                const storageUri = storage.storeFile
                  ? await storage.storeFile(key, filePath, mimeType)
                  : await storage.store(key, await fs.readFile(filePath), mimeType);
                return { storageUri, fileSize: stat.size };
              };

              const firstEntry = entries[0];
              const mimeType = firstEntry.mimeType || 'application/octet-stream';
              const ext = path.extname(firstEntry.path).slice(1) || 'mp4';
              const key = `videos/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
              const storedFirstEntry = await storeDownloadedFile(firstEntry.path, key, mimeType);

              currentAsset =
                (await updateMediaAsset(currentAsset.id, {
                  fileName: firstEntry.title || path.basename(firstEntry.path),
                  mimeType,
                  ...storedFirstEntry,
                })) || currentAsset;
              await reportStage('download', {
                status: 'completed',
                message: 'Download complete.',
              });
              if (firstEntry.sourceTranscript?.chunks?.length) {
                sourceTranscripts.set(currentAsset.id, firstEntry.sourceTranscript);
              }

              if (entries.length > 1) {
                const newInputs: import('@larkup/core/media-store').NewMediaAssetInput[] = [];
                for (let i = 1; i < entries.length; i++) {
                  const entry = entries[i];
                  const entryMime = entry.mimeType || 'application/octet-stream';
                  const entryExt = path.extname(entry.path).slice(1) || 'mp4';
                  const entryKey = `videos/${Date.now()}_${Math.random()
                    .toString(36)
                    .slice(2)}.${entryExt}`;
                  const storedEntry = await storeDownloadedFile(entry.path, entryKey, entryMime);
                  newInputs.push({
                    type: currentAsset.type,
                    fileName: entry.title || path.basename(entry.path),
                    mimeType: entryMime,
                    ...storedEntry,
                    originalUrl: entry.originalUrl || currentAsset.originalUrl,
                  });
                }
                const extraAssets = await addMediaAssets(newInputs);
                const claimedExtraAssets = (
                  await Promise.all(extraAssets.map((extraAsset) => claimMediaAsset(extraAsset.id)))
                ).filter((extraAsset): extraAsset is MediaAsset => Boolean(extraAsset));
                claimedExtraAssets.forEach((extraAsset) => {
                  const sourceIndex = extraAssets.findIndex(
                    (candidate) => candidate.id === extraAsset.id,
                  );
                  const transcript = entries[sourceIndex + 1]?.sourceTranscript;
                  if (transcript?.chunks?.length) sourceTranscripts.set(extraAsset.id, transcript);
                  queuedAssetIds.add(extraAsset.id);
                });

                toProcess.push(...claimedExtraAssets);
              }
            } finally {
              await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
            }
          } else {
            await reportStage('download', {
              status: 'skipped',
              message: 'Using uploaded media.',
            });
          }

          if (currentAsset.type === 'image') {
            await processImageAsset(currentAsset, reqUrl, reportStage, serverId);
          } else if (currentAsset.type === 'video' || currentAsset.type === 'audio') {
            const installed = await isToolInstalled(
              currentAsset.type === 'video' ? 'video-intelligence' : 'video-audio',
            );
            if (!installed) {
              throw new Error(
                currentAsset.type === 'video'
                  ? 'Video Intelligence is not installed. Install it from the Marketplace.'
                  : 'Audio Transcription is not installed. Install it from the Marketplace.',
              );
            }
            await processMediaWithTool(
              currentAsset,
              reqUrl,
              reportStage,
              sourceTranscripts.get(currentAsset.id),
              serverId,
            );
          } else {
            throw new Error('Unsupported media type');
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Processing failed';
          await Promise.all(
            [...activeStages].map((stage) =>
              updateMediaStage(currentAsset.id, stage, {
                status: 'failed',
                message,
              }),
            ),
          );
          await updateMediaAsset(currentAsset.id, {
            processingStatus: 'failed',
            processingError: message,
            processingMessage: undefined,
            processingProgress: undefined,
          });
        } finally {
          if (heartbeat) clearInterval(heartbeat);
        }
      }
    };
    const job = mediaProcessingChain
      .then(() => (serverId ? runWithProject(serverId, runJob) : runJob()))
      .finally(() => clearInterval(queuedHeartbeat));
    mediaProcessingChain = job.catch((error) => console.error('Media worker failed:', error));

    return NextResponse.json(
      { success: true, message: 'Processing started in background' },
      { status: 202 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to trigger processing';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/* Media processing helpers. */
/* Image processing (built-in, no tool needed)                         */
/* End media processing helpers. */

async function processImageAsset(
  asset: MediaAsset,
  reqUrl: string,
  reportStage: StageReporter,
  serverId?: string,
): Promise<void> {
  await cleanupIncompleteMediaPublication(asset);
  let caption = `Image: ${asset.fileName}`;
  await Promise.all([
    reportStage('extract', { status: 'skipped', message: 'No extraction needed.' }),
    reportStage('transcribe', { status: 'skipped', message: 'No audio track.' }),
    reportStage('synthesize', { status: 'skipped', message: 'Caption is the media note.' }),
  ]);
  await reportStage('vision', {
    status: 'running',
    percent: 0,
    message: `Understanding image: ${asset.fileName}`,
  });

  try {
    const storage = createStorageProvider();
    const fileData = await storage.retrieve(asset.storageUri);
    const base64 = fileData.toString('base64');

    const descRes = await fetch(scopedApiUrl('/api/describe-image', reqUrl, serverId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64 }),
    });

    if (descRes.ok) {
      const descData = await descRes.json();
      if (descData.description) {
        caption = descData.description;
      }
    }
  } catch (err) {
    console.error('Failed to describe image asset:', err);
  }
  await reportStage('vision', {
    status: 'completed',
    message: 'Image understanding complete.',
  });

  const documentId = randomUUID();
  let indexAttempted = false;
  try {
    if (!(await updateMediaAsset(asset.id, { pendingDocumentIds: [documentId] }))) {
      throw new Error('Media asset was removed before its evidence could be published.');
    }
    const doc = await addDocument({
      id: documentId,
      title: asset.fileName,
      content: caption,
      source: 'media',
      url: `/api/media/${asset.id}`,
      metadata: {
        mediaAssetId: asset.id,
        mediaType: 'image',
        fileName: asset.fileName,
        mimeType: asset.mimeType,
        fileSize: asset.fileSize,
        dimensions: asset.dimensions,
        images: [
          {
            imageUrl: `/api/media/${asset.id}`,
            pageNumber: 1,
            index: 0,
          },
        ],
      },
    });
    await reportStage('index', {
      status: 'running',
      percent: 0,
      message: 'Building the searchable index...',
    });
    indexAttempted = true;
    await ensureSearchable((current, total, message) =>
      reportStage('index', { status: 'running', current, total, unit: 'chunks', message }),
    );
    await reportStage('index', {
      status: 'completed',
      message: 'Image is searchable.',
    });
    const publishedAsset = await updateMediaAsset(asset.id, {
      processingStatus: 'completed',
      processingProgress: 100,
      processingMessage: undefined,
      caption,
      documentIds: [doc.id],
      pendingDocumentIds: [],
      supersededDocumentIds: asset.documentIds,
    });
    if (!publishedAsset) {
      throw new Error('Media asset was removed before indexing completed.');
    }
    if (await cleanupDocumentRecords(asset.documentIds)) {
      await updateMediaAsset(asset.id, { supersededDocumentIds: [] }).catch((error) =>
        console.error('Failed to clear superseded image document IDs:', error),
      );
    }
  } catch (error) {
    await rollbackPendingDocuments(asset.id, [documentId], indexAttempted);
    throw error;
  }
}

/* Background processing. */
/* Video/Audio processing (requires marketplace tool)                  */
/* End background processing. */

/**
 * A reprocessing pass must never silently shrink an already-known duration.
 * A worker's own account of a file's length (decode, transcription coverage)
 * can under-report when it hits a partial decode or provider length cap;
 * trusting that over a previously verified value would mis-anchor every
 * "near the end" lookup on the asset to a point well before the real end.
 */
function preserveDurationSecs(
  asset: MediaAsset,
  candidateSecs: number | undefined,
): number | undefined {
  const existing = asset.durationSecs;
  if (!Number.isFinite(candidateSecs)) return existing;
  if (Number.isFinite(existing) && (existing as number) > (candidateSecs as number))
    return existing;
  return candidateSecs;
}

async function processMediaWithTool(
  asset: MediaAsset,
  reqUrl: string,
  reportStage: StageReporter,
  sourceTranscript?: {
    chunks: any[];
    fullText: string;
    durationSecs: number;
    language?: string;
    origin?: { kind?: string; provider?: string; language?: string };
  },
  serverId?: string,
): Promise<void> {
  if (asset.type === 'video' && (await isToolInstalled('video-intelligence'))) {
    return processWithInstalledVideoIntelligence(asset, reportStage);
  }
  const tool = await loadTool<any>('video-audio');
  if (!tool) {
    throw new Error('The installed Video & Audio tool needs an update.');
  }
  await cleanupIncompleteMediaPublication(asset);

  const storage = createStorageProvider();

  const { promises: fs } = await import('node:fs');
  const path = await import('node:path');
  const os = await import('node:os');

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'larkup-media-'));
  const ext = asset.fileName.split('.').pop() || 'tmp';
  const localFile = await storage.resolvePath?.(asset.storageUri);
  const tmpFile = localFile || path.join(tmpDir, `input.${ext}`);
  if (!localFile) {
    await fs.writeFile(tmpFile, await storage.retrieve(asset.storageUri));
  }
  const documentIds: string[] = [];
  let published = false;
  let indexAttempted = false;
  let knowledgeRun:
    | { revisionId: string; jobId: string; owner: string; signal: AbortSignal; release: () => void }
    | undefined;

  try {
    const installedTool = await getInstalledTool('video-audio');
    const globalConfig = await readConfig();
    const toolConfig = globalConfig.toolConfigs?.['video-audio'] || {};
    const videoKnowledgeEnabled =
      toolConfig.videoKnowledgeEnabled !== false && toolConfig.videoKnowledgeEnabled !== 'false';
    const provider = typeof toolConfig.audioProvider === 'string' ? toolConfig.audioProvider : '';
    const apiKey = typeof toolConfig.audioApiKey === 'string' ? toolConfig.audioApiKey : '';
    const hasSourceTranscript = Boolean(sourceTranscript?.chunks?.length);
    if (!hasSourceTranscript && !provider) {
      throw new Error(
        'Choose an Audio Provider in Settings → Marketplace Tools → Video & Audio before indexing media.',
      );
    }
    if (!hasSourceTranscript && provider !== 'local' && !apiKey) {
      throw new Error(
        'Add the API key for the selected Audio Provider in Settings → Marketplace Tools → Video & Audio.',
      );
    }
    const frameIntervalSecs = qualityToFrameInterval(
      asset.indexingQuality,
      Number(toolConfig.frameInterval ?? installedTool?.config?.frameInterval ?? 30) || 30,
    );
    const configuredMaxFrames = Number(toolConfig.maxFrames);
    const maxFrames =
      Number.isFinite(configuredMaxFrames) && configuredMaxFrames > 0
        ? Math.min(2_000, Math.floor(configuredMaxFrames))
        : qualityToMaxFrames(asset.indexingQuality);
    const configuredChunkDuration = Number(toolConfig.chunkDurationSecs);
    const chunkDurationSecs =
      Number.isFinite(configuredChunkDuration) && configuredChunkDuration > 0
        ? Math.max(30, Math.min(1_800, Math.floor(configuredChunkDuration)))
        : 300;
    const language =
      typeof toolConfig.audioLanguage === 'string' ? toolConfig.audioLanguage : 'auto';
    const effectiveLanguage =
      language.trim().toLowerCase() === 'auto' && sourceTranscript?.language
        ? sourceTranscript.language
        : language;
    const localUrl = `/api/media/${asset.id}`;
    const userInstructions = asset.indexingInstructions?.trim() || '';

    // Duration limit: reject videos that exceed the configured maximum.
    const maxDurationSecs = Number(toolConfig.maxDurationSecs) || 14_400;
    let preflightProbe: { durationSecs: number } | undefined;
    if (maxDurationSecs > 0) {
      try {
        const probe = await probeMedia(tmpFile);
        preflightProbe = probe;
        if (probe.durationSecs > maxDurationSecs) {
          const hours = Math.floor(maxDurationSecs / 3600);
          const mins = Math.floor((maxDurationSecs % 3600) / 60);
          const limit = hours > 0 ? `${hours}h${mins > 0 ? ` ${mins}m` : ''}` : `${mins}m`;
          throw new Error(
            `This ${Math.floor(
              probe.durationSecs / 60,
            )}-minute video exceeds the ${limit} maximum. ` +
              'Increase "Maximum video duration" in Settings → Marketplace Tools → Video & Audio.',
          );
        }
        if (probe.hasCorruptionSignals) {
          console.warn(
            `[media] Probe detected corruption signals for asset ${asset.id}; proceeding with best effort.`,
          );
        }
      } catch (err) {
        if (err instanceof Error && err.message.includes('exceeds the')) throw err;
        // Probe failure is non-fatal: the processing pipeline will fail on
        // its own if the file is truly unreadable.
        console.warn('[media] Pre-processing probe failed; continuing:', err);
      }
    }

    const limits = getConcurrencyLimits();

    if (asset.type === 'video' && tool.processVideo) {
      const sourceKind = sourceTranscript?.origin?.kind;
      await reportStage('extract', {
        status: 'running',
        percent: 0,
        message: `Extracting adaptive frames and audio (${limits.ffmpegThreads} FFmpeg threads)...`,
      });
      if (videoKnowledgeEnabled) {
        knowledgeRun = await beginVideoKnowledgeRun({
          asset,
          mediaPath: tmpFile,
          durationSecs: preflightProbe?.durationSecs ?? 0,
          maxDurationSecs,
          maxFrames,
          maxInspectionSpendUsd: Math.max(0, Number(toolConfig.maxInspectionSpendUsd) || 0),
        });
        await updateMediaAsset(asset.id, { activeVideoKnowledgeJobId: knowledgeRun.jobId });
        await checkpointVideoKnowledgeJob(knowledgeRun.jobId, knowledgeRun.owner, 'extracting', {
          chunkIndex: 0,
        });
      }
      const result = await tool.processVideo(tmpFile, {
        outputDir: tmpDir,
        frameIntervalSecs,
        maxFrames,
        chunkDurationSecs,
        threads: limits.ffmpegThreads,
        parallelExtraction: limits.canParallelizeFfmpeg,
        skipAudioExtraction: hasSourceTranscript,
        signal: knowledgeRun?.signal,
        onProgress: (value: number) => {
          void reportStage('extract', {
            status: 'running',
            percent: Math.round(Math.max(0, Math.min(1, value)) * 100),
            message: `Extracting adaptive frames and audio (${Math.round(value * 100)}%)...`,
          }).catch(() => {});
        },
      });
      void trackUsageEvent({
        type: 'media_processing',
        mediaType: 'video',
        mediaOperation: 'probe',
        durationSecs: result.meta.durationSecs,
        timestamp: new Date().toISOString(),
      });
      await assertVideoKnowledgeJobActive(knowledgeRun);
      if (knowledgeRun) {
        await persistVideoFrameArtifacts({
          mediaAssetId: asset.id,
          knowledgeRevisionId: knowledgeRun.revisionId,
          frames: result.frames,
        });
      }
      await reportStage('extract', {
        status: 'completed',
        current: result.frames.length,
        total: result.frames.length,
        unit: 'frames',
        message: `Extracted ${result.frames.length} adaptive frames and the audio track.`,
      });

      let transcriptPromise: Promise<any | null> = Promise.resolve(
        hasSourceTranscript ? sourceTranscript : null,
      );

      if (hasSourceTranscript) {
        await reportStage('transcribe', {
          status: 'completed',
          current: sourceTranscript?.chunks.length,
          total: sourceTranscript?.chunks.length,
          unit: 'caption sections',
          message: `Indexed ${
            sourceTranscript?.chunks.length ?? 0
          } timestamped source-caption sections; no audio transcription was needed.`,
        });
        void trackUsageEvent({
          type: 'media_processing',
          mediaType: 'video',
          mediaOperation: 'source_transcript',
          durationSecs: sourceTranscript?.durationSecs,
          timestamp: new Date().toISOString(),
        });
      } else if (result.audioPath && tool.processAudio) {
        transcriptPromise = (async () => {
          await reportStage('transcribe', {
            status: 'running',
            percent: 0,
            message: `Transcribing with ${formatProviderName(provider)}...`,
          });
          try {
            const providerTranscript = await tool.processAudio(result.audioPath, {
              provider,
              apiKey,
              language: effectiveLanguage,
              context: asset.fileName,
              onProgress: (current: number, total: number, message: string, unit?: string) => {
                void reportStage('transcribe', {
                  status: 'running',
                  current,
                  total,
                  unit: unit || 'audio parts',
                  message:
                    message ||
                    `Transcribing part ${Math.min(
                      current,
                      total,
                    )} of ${total} with ${formatProviderName(provider)}...`,
                }).catch(() => {});
              },
            });
            await reportStage('transcribe', {
              status: 'completed',
              message: `Transcription complete with ${formatProviderName(provider)} (${
                providerTranscript.chunks?.length ?? 0
              } timestamped sections).`,
            });
            return providerTranscript;
          } catch (error) {
            if (sourceKind === 'youtube-auto' && sourceTranscript?.chunks?.length) {
              console.warn(
                `Configured ${formatProviderName(
                  provider,
                )} transcription failed; using YouTube automatic captions as fallback.`,
                error,
              );
              await reportStage('transcribe', {
                status: 'completed',
                message: `Provider transcription failed; using ${sourceTranscript.chunks.length} YouTube automatic-caption sections as fallback.`,
              });
              return sourceTranscript;
            }
            throw error;
          }
        })();
      } else if (sourceTranscript?.chunks?.length) {
        await reportStage('transcribe', {
          status: 'completed',
          current: sourceTranscript.chunks.length,
          total: sourceTranscript.chunks.length,
          unit: 'caption sections',
          message: 'Using source captions because the video has no extractable audio track.',
        });
        transcriptPromise = Promise.resolve(sourceTranscript);
      } else {
        await reportStage('transcribe', {
          status: 'skipped',
          message: 'No audio track or source captions were available.',
        });
      }

      const scenePromise = (async () => {
        const extractedFrames = result.frames as { path: string; timestampSecs: number }[];
        const analysisWindowSecs = visualAnalysisWindow(result.meta.durationSecs);
        const frameGroups = groupFramesByWindow(extractedFrames, analysisWindowSecs, 12);
        if (frameGroups.length === 0) {
          await reportStage('vision', {
            status: 'skipped',
            message: 'No readable video frames were extracted.',
          });
          return [];
        }
        await reportStage('vision', {
          status: 'running',
          current: 0,
          total: frameGroups.length,
          unit: 'sequences',
          message: `Understanding 0 of ${frameGroups.length} visual sequences...`,
        });
        let analyzed = 0;
        let skipped = 0;
        let visionThrottled = false;
        let lastVisionRequestAt = 0;
        let runningContext = '';
        const visionProvider =
          globalConfig.visionProvider ||
          globalConfig.chatProvider ||
          globalConfig.embeddingProvider;
        const visionConcurrency = visionProvider === 'google' ? 1 : limits.apiConcurrency;
        const visionMinIntervalMs = visionProvider === 'google' ? 4_250 : 0;
        const recordProgress = () => {
          analyzed++;
          const progressStep = Math.max(1, Math.ceil(frameGroups.length / 100));
          if (analyzed % progressStep === 0 || analyzed === frameGroups.length) {
            void reportStage('vision', {
              status: 'running',
              current: analyzed,
              total: frameGroups.length,
              unit: 'sequences',
              message: `Understanding visual sequence ${analyzed} of ${frameGroups.length}...`,
            }).catch(() => {});
          }
        };
        // Vision is deliberately invoked through the server-only, schema
        // validating adapter. Free-form captions are useful presentation
        // projections, but they must never be the durable source of truth.
        const visionAdapter = createConfiguredVisionAdapter();
        const descriptions = await mapConcurrent(
          frameGroups,
          visionConcurrency,
          async (frames: { path: string; timestampSecs: number }[], groupIndex: number) => {
            if (visionThrottled) {
              skipped++;
              recordProgress();
              return null;
            }
            const startSecs = frames[0].timestampSecs;
            const endSecs = Math.min(
              result.meta.durationSecs,
              Math.max(startSecs + 1, frames.at(-1)!.timestampSecs + frameIntervalSecs),
            );
            if (visionMinIntervalMs > 0) {
              const remaining = visionMinIntervalMs - (Date.now() - lastVisionRequestAt);
              if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
            }
            lastVisionRequestAt = Date.now();

            try {
              const analysis = await visionAdapter.analyze({
                frames,
                previousContext: [runningContext, userInstructions].filter(Boolean).join('\n'),
                signal: knowledgeRun?.signal,
              });
              const text = analysis.observations.map((observation) => observation.value).join(' ');
              if (text) {
                runningContext = extractRunningState(`${runningContext}\n${text}`);
              }
              return text
                ? {
                    text,
                    startSecs,
                    endSecs: Math.max(startSecs + 1, endSecs),
                    observations: analysis.observations,
                  }
                : null;
            } catch (error) {
              skipped++;
              console.warn(
                `Visual sequence ${formatTime(startSecs)}–${formatTime(
                  endSecs,
                )} failed; preserving the remaining transcript evidence.`,
                error,
              );
              return null;
            } finally {
              recordProgress();
            }
          },
        );
        await reportStage('vision', {
          status: 'completed',
          current: frameGroups.length,
          total: frameGroups.length,
          unit: 'sequences',
          message:
            skipped > 0
              ? `Understood ${
                  frameGroups.length - skipped
                } visual sequences; ${skipped} were skipped while the vision provider was unavailable. Speech evidence remains searchable.`
              : `Understood ${frameGroups.length} visual sequences with OCR.`,
        });
        return descriptions;
      })();

      const ocrPromise = knowledgeRun
        ? extractOfflineOcrEvidence({
            mediaAssetId: asset.id,
            knowledgeRevisionId: knowledgeRun.revisionId,
            frames: result.frames,
            maxFrames: Math.max(1, Math.min(120, Number(toolConfig.maxOcrFrames) || 60)),
            signal: knowledgeRun.signal,
            concurrency: limits.apiConcurrency,
          })
        : Promise.resolve<OfflineKnowledgeEvidenceInput[]>([]);

      const [transcript, sceneDescriptions, ocrEvidence] = await Promise.all([
        transcriptPromise,
        scenePromise,
        ocrPromise,
      ]);
      await assertVideoKnowledgeJobActive(knowledgeRun);

      const validScenes = sceneDescriptions.filter(
        (scene): scene is NonNullable<typeof scene> => scene !== null,
      );
      const segments = tool.buildMultimodalSegments(
        transcript?.chunks ?? [],
        validScenes,
        result.meta.durationSecs,
        visualAnalysisWindow(result.meta.durationSecs),
      ) as MediaEvidenceSegment[];

      if (segments.length === 0) {
        throw new Error('No searchable speech or visual evidence was produced from this video.');
      }

      await reportStage('synthesize', {
        status: 'running',
        percent: 0,
        message: 'Creating human-style notes across the complete video...',
      });
      let summary: string;
      try {
        summary = await createMediaKnowledgeSummary({
          title: asset.fileName,
          mediaType: 'video',
          durationSecs: result.meta.durationSecs,
          segments,
          config: globalConfig,
          onProgress: (completed, total, message) =>
            reportStage('synthesize', {
              status: 'running',
              current: completed,
              total,
              unit: 'note passes',
              message,
            }),
        });
        await reportStage('synthesize', {
          status: 'completed',
          message: 'Connected the complete timeline into searchable notes.',
        });
      } catch (error) {
        console.error('Video evidence synthesis failed; preserving timestamped evidence:', error);
        summary = createFallbackMediaSummary(asset.fileName, 'video', segments);
        await reportStage('synthesize', {
          status: 'completed',
          message: 'Saved timeline notes; the optional consolidation pass was unavailable.',
        });
      }

      const transcriptSource = transcript?.origin?.kind || 'provider-stt';
      const documentInputs = buildMediaDocumentInputs({
        assetId: asset.id,
        title: asset.fileName,
        mediaType: 'video',
        localUrl,
        originalUrl: asset.originalUrl,
        durationSecs: result.meta.durationSecs,
        summary,
        segments,
        fileName: asset.fileName,
        mimeType: asset.mimeType,
        transcriptSource,
        transcriptProvider: transcript?.origin?.provider || provider,
        transcriptLanguage: transcript?.language,
        knowledgeRevisionId: knowledgeRun?.revisionId,
      }).map((input) => ({ ...input, id: randomUUID(), groupId: asset.groupId || 'default' }));
      documentIds.push(...documentInputs.map((input) => input.id));
      if (!(await updateMediaAsset(asset.id, { pendingDocumentIds: documentIds }))) {
        throw new Error('Media asset was removed before its evidence could be published.');
      }
      const documents = await addDocuments(documentInputs);
      await assertVideoKnowledgeJobActive(knowledgeRun);

      await reportStage('index', {
        status: 'running',
        percent: 0,
        message: `Indexing ${documents.length} media documents...`,
      });
      indexAttempted = true;
      await ensureSearchable(
        (current, total, message) =>
          reportStage('index', {
            status: 'running',
            current,
            total,
            unit: 'chunks',
            message,
          }),
        provider,
      );
      await reportStage('index', {
        status: 'completed',
        message: 'Video timeline and notes are searchable.',
      });
      let activeManifestId: string | undefined;
      if (knowledgeRun) {
        const manifest = await publishVideoKnowledge({
          assetId: asset.id,
          knowledgeRun,
          segments,
          transcriptChunks: transcript?.chunks ?? [],
          visualObservations: validScenes,
          ocrEvidence,
          documentIds: documents.map((document) => ({
            documentId: document.id,
            kind: document.metadata?.isMediaSummary
              ? 'overview'
              : document.metadata?.contentKind === 'media-chapter'
                ? 'chapter'
                : document.metadata?.contentKind === 'multimodal-segment'
                  ? 'scene'
                  : document.metadata?.contentKind === 'video-visual'
                    ? 'visual'
                    : 'transcript',
            startSecs: Number.isFinite(Number(document.metadata?.startSecs))
              ? Number(document.metadata?.startSecs)
              : undefined,
            endSecs: Number.isFinite(Number(document.metadata?.endSecs))
              ? Number(document.metadata?.endSecs)
              : undefined,
          })),
        });
        activeManifestId = manifest.id;
        void trackUsageEvent({
          type: 'media_processing',
          mediaType: 'video',
          mediaOperation: 'projection',
          durationSecs: result.meta.durationSecs,
          timestamp: new Date().toISOString(),
        });
      }
      // Publication is deliberately last: a manifest activates only after all
      // replacement documents indexed, and the asset swaps its document IDs
      // in the same final step. An earlier failure leaves old IDs untouched.
      const publishedAsset = await updateMediaAsset(asset.id, {
        processingStatus: 'completed',
        caption: summary.slice(0, 600),
        durationSecs: preserveDurationSecs(asset, result.meta.durationSecs),
        dimensions: { width: result.meta.width, height: result.meta.height },
        documentIds,
        pendingDocumentIds: [],
        supersededDocumentIds: asset.documentIds,
        processingProgress: 100,
        processingMessage: undefined,
        ...(knowledgeRun
          ? {
              activeVideoKnowledgeRevisionId: knowledgeRun.revisionId,
              activeVideoKnowledgeManifestId: activeManifestId,
            }
          : {}),
      });
      if (!publishedAsset) {
        throw new Error('Media asset was removed before indexing completed.');
      }
      published = true;
      if (await cleanupDocumentRecords(asset.documentIds)) {
        await updateMediaAsset(asset.id, { supersededDocumentIds: [] }).catch((error) =>
          console.error('Failed to clear superseded video document IDs:', error),
        );
      }
      await trackMediaProcessing('video', result.meta.durationSecs, result.frames.length, provider);
    } else if (asset.type === 'audio' && tool.processAudio) {
      await Promise.all([
        reportStage('extract', { status: 'skipped', message: 'No video frames to extract.' }),
        reportStage('vision', { status: 'skipped', message: 'Audio-only media.' }),
      ]);
      await reportStage('transcribe', {
        status: 'running',
        percent: 0,
        message: `Transcribing with ${formatProviderName(provider)}...`,
      });
      const transcript = await tool.processAudio(tmpFile, {
        provider,
        apiKey,
        language: effectiveLanguage,
        context: asset.fileName,
        onProgress: (current: number, total: number, message: string, unit?: string) =>
          reportStage('transcribe', {
            status: 'running',
            current,
            total,
            unit: unit || 'audio parts',
            message:
              message || `Transcribing audio part ${Math.min(current, total)} of ${total}...`,
          }),
      });
      await reportStage('transcribe', {
        status: 'completed',
        message: `Transcription complete with ${formatProviderName(provider)} (${
          transcript.chunks.length
        } timestamped sections).`,
      });
      const segments = tool.buildMultimodalSegments(
        transcript.chunks,
        [],
        transcript.durationSecs,
        60,
      ) as MediaEvidenceSegment[];
      if (videoKnowledgeEnabled) {
        knowledgeRun = await beginVideoKnowledgeRun({
          asset,
          mediaPath: tmpFile,
          durationSecs: transcript.durationSecs,
          maxDurationSecs,
          maxFrames: 0,
        });
        await updateMediaAsset(asset.id, { activeVideoKnowledgeJobId: knowledgeRun.jobId });
      }
      if (segments.length === 0) {
        throw new Error('The transcription completed without searchable speech.');
      }

      await reportStage('synthesize', {
        status: 'running',
        percent: 0,
        message: 'Creating human-style notes across the complete recording...',
      });
      let summary: string;
      try {
        summary = await createMediaKnowledgeSummary({
          title: asset.fileName,
          mediaType: 'audio',
          durationSecs: transcript.durationSecs,
          segments,
          config: globalConfig,
          onProgress: (completed, total, message) =>
            reportStage('synthesize', {
              status: 'running',
              current: completed,
              total,
              unit: 'note passes',
              message,
            }),
        });
        await reportStage('synthesize', {
          status: 'completed',
          message: 'Connected the complete transcript into searchable notes.',
        });
      } catch (error) {
        console.error('Audio evidence synthesis failed; preserving timestamped evidence:', error);
        summary = createFallbackMediaSummary(asset.fileName, 'audio', segments);
        await reportStage('synthesize', {
          status: 'completed',
          message: 'Saved timeline notes; the optional consolidation pass was unavailable.',
        });
      }

      const documentInputs = buildMediaDocumentInputs({
        assetId: asset.id,
        title: asset.fileName,
        mediaType: 'audio',
        localUrl,
        originalUrl: asset.originalUrl,
        durationSecs: transcript.durationSecs,
        summary,
        segments,
        fileName: asset.fileName,
        mimeType: asset.mimeType,
        transcriptSource: transcript?.origin?.kind || 'provider-stt',
        transcriptProvider: transcript?.origin?.provider || provider,
        transcriptLanguage: transcript.language,
        knowledgeRevisionId: knowledgeRun?.revisionId,
      }).map((input) => ({ ...input, id: randomUUID(), groupId: asset.groupId || 'default' }));
      documentIds.push(...documentInputs.map((input) => input.id));
      if (!(await updateMediaAsset(asset.id, { pendingDocumentIds: documentIds }))) {
        throw new Error('Media asset was removed before its evidence could be published.');
      }
      const documents = await addDocuments(documentInputs);
      await assertVideoKnowledgeJobActive(knowledgeRun);

      await reportStage('index', {
        status: 'running',
        percent: 0,
        message: `Indexing ${documents.length} media documents...`,
      });
      indexAttempted = true;
      await ensureSearchable(
        (current, total, message) =>
          reportStage('index', {
            status: 'running',
            current,
            total,
            unit: 'chunks',
            message,
          }),
        provider,
      );
      await reportStage('index', {
        status: 'completed',
        message: 'Audio transcript and notes are searchable.',
      });
      let activeManifestId: string | undefined;
      if (knowledgeRun) {
        const manifest = await publishVideoKnowledge({
          assetId: asset.id,
          knowledgeRun,
          segments,
          transcriptChunks: transcript.chunks,
          visualObservations: [],
          ocrEvidence: [],
          documentIds: documents.map((document) => ({
            documentId: document.id,
            kind: document.metadata?.isMediaSummary
              ? 'overview'
              : document.metadata?.contentKind === 'media-chapter'
                ? 'chapter'
                : 'transcript',
            startSecs: Number.isFinite(Number(document.metadata?.startSecs))
              ? Number(document.metadata?.startSecs)
              : undefined,
            endSecs: Number.isFinite(Number(document.metadata?.endSecs))
              ? Number(document.metadata?.endSecs)
              : undefined,
          })),
        });
        activeManifestId = manifest.id;
      }
      const publishedAsset = await updateMediaAsset(asset.id, {
        processingStatus: 'completed',
        caption: summary.slice(0, 600),
        durationSecs: preserveDurationSecs(asset, transcript.durationSecs),
        documentIds,
        pendingDocumentIds: [],
        supersededDocumentIds: asset.documentIds,
        processingProgress: 100,
        processingMessage: undefined,
        ...(knowledgeRun
          ? {
              activeVideoKnowledgeRevisionId: knowledgeRun.revisionId,
              activeVideoKnowledgeManifestId: activeManifestId,
            }
          : {}),
      });
      if (!publishedAsset) {
        throw new Error('Media asset was removed before indexing completed.');
      }
      published = true;
      if (await cleanupDocumentRecords(asset.documentIds)) {
        await updateMediaAsset(asset.id, { supersededDocumentIds: [] }).catch((error) =>
          console.error('Failed to clear superseded audio document IDs:', error),
        );
      }
      await trackMediaProcessing('audio', transcript.durationSecs, 0, provider);
    }
  } catch (error) {
    if (knowledgeRun) {
      const message = error instanceof Error ? error.message : 'Video knowledge processing failed.';
      const cancelled = /cancelled/i.test(message);
      await updateVideoKnowledgeRevision(knowledgeRun.revisionId, {
        status: cancelled ? 'cancelled' : 'failed',
      }).catch(() => {});
      await finishVideoKnowledgeJob(
        knowledgeRun.jobId,
        knowledgeRun.owner,
        cancelled ? 'cancelled' : 'failed',
        message,
      ).catch(() => {});
    }
    if (!published) {
      await rollbackPendingDocuments(asset.id, documentIds, indexAttempted);
    }
    throw error;
  } finally {
    knowledgeRun?.release();
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function processWithInstalledVideoIntelligence(
  asset: MediaAsset,
  reportStage: StageReporter,
): Promise<void> {
  await validateVideoIntelligenceConfiguration();
  // Capture this before the job begins. A later settings change must not
  // relabel evidence that was already produced by the prior runtime.
  const indexingConfig = await readConfig();
  const videoRuntimeScope = videoRuntimeScopeFromConfig(indexingConfig);
  await cleanupIncompleteMediaPublication(asset);
  const storage = createStorageProvider();
  const { promises: fs } = await import('node:fs');
  const path = await import('node:path');
  const os = await import('node:os');
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'larkup-video-intelligence-'));
  const extension = asset.fileName.split('.').pop() || 'video';
  const localFile = await storage.resolvePath?.(asset.storageUri);
  const mediaPath = localFile || path.join(tmpDir, `source.${extension}`);
  const documentIds: string[] = [];
  let indexAttempted = false;
  let knowledgeRun: Awaited<ReturnType<typeof beginVideoKnowledgeRun>> | undefined;
  try {
    if (!localFile) await fs.writeFile(mediaPath, await storage.retrieve(asset.storageUri));
    const assetForCloud = await ensureCloudVideoDuration(asset, mediaPath, reportStage);
    // A durable canonical copy already exists at asset.storageUri (S3), so
    // hand the GPU worker a presigned read of that instead of re-uploading
    // the same bytes through client.upload()'s sources/ PUT step. mediaPath
    // stays local regardless -- duration probing and knowledge-run frame
    // artifacts above/below still need it.
    const sourceUrl = await storage.getReadUrl?.(asset.storageUri, 3_600);
    const { evidence, segments } = await runInstalledVideoIntelligence({
      asset: assetForCloud,
      mediaPath,
      sourceUrl,
      reportStage,
      onJobSubmitted: async (jobId) => {
        const updated = await updateMediaAsset(asset.id, { activeVideoIntelligenceJobId: jobId });
        if (!updated) throw new Error('The video was removed before cloud indexing started.');
      },
      assertStillActive: async () => {
        const current = (await readMediaAssets()).find((candidate) => candidate.id === asset.id);
        if (!current) throw new Error('The video was removed before cloud indexing started.');
      },
    });
    if (!segments.length) {
      throw new Error(
        'Video Intelligence produced no searchable speech, visual, or semantic video evidence.',
      );
    }
    knowledgeRun = await beginVideoKnowledgeRun({
      asset,
      mediaPath,
      durationSecs: evidence.durationMs / 1_000,
      maxDurationSecs: Math.max(1, evidence.durationMs / 1_000),
      maxFrames: Math.max(1, evidence.visualObservations.length),
    });
    await reportStage('extract', {
      status: 'completed',
      message: `Decoded ${evidence.video.width}×${evidence.video.height} timestamped evidence.`,
    });
    await reportStage('synthesize', {
      status: 'running',
      percent: 50,
      message: 'Publishing the worker’s audited timeline...',
    });
    // The worker has already skimmed the source, synthesized a structured
    // account, and consistency-audited claims against timestamped evidence.
    // Running the host's generic media summarizer again costs several model
    // calls and can blur those exact timestamps, so publish the audited result
    // directly and fall back only if an older runtime omitted it.
    const summary =
      formatVideoKnowledgeSummary(evidence) ??
      createFallbackMediaSummary(asset.fileName, 'video', segments);
    await reportStage('synthesize', {
      status: 'completed',
      message: 'Prepared evidence-backed notes for chat.',
    });
    const inputs = buildMediaDocumentInputs({
      assetId: asset.id,
      title: asset.fileName,
      mediaType: 'video',
      localUrl: `/api/media/${asset.id}`,
      originalUrl: asset.originalUrl,
      durationSecs: evidence.durationMs / 1_000,
      summary,
      segments,
      fileName: asset.fileName,
      mimeType: asset.mimeType,
      transcriptSource: 'video-intelligence-runtime',
      transcriptProvider:
        evidence.transcriptionDiagnostics?.fallbackUsed &&
        evidence.transcriptionDiagnostics.fallbackProvider
          ? evidence.transcriptionDiagnostics.fallbackProvider
          : evidence.transcriptionDiagnostics?.provider || 'video-intelligence-runtime',
      transcriptLanguage: evidence.detectedLanguage,
      videoRuntimeScope,
    }).map((input) => ({ ...input, id: randomUUID(), groupId: asset.groupId || 'default' }));
    documentIds.push(...inputs.map((input) => input.id));
    if (!(await updateMediaAsset(asset.id, { pendingDocumentIds: documentIds }))) {
      throw new Error('Media asset was removed before its evidence could be published.');
    }
    const documents = await addDocuments(inputs);
    await reportStage('index', {
      status: 'running',
      percent: 0,
      message: `Indexing ${documents.length} timestamped evidence documents...`,
    });
    indexAttempted = true;
    await ensureSearchable((current, total, message) =>
      reportStage('index', {
        status: 'running',
        current,
        total,
        unit: 'chunks',
        message,
      }),
    );
    await reportStage('index', {
      status: 'completed',
      message: 'Video evidence, including semantic scene analysis, is searchable.',
    });
    const activeManifest = await publishVideoKnowledge({
      assetId: asset.id,
      knowledgeRun,
      segments,
      ...evidenceToKnowledgeInputs(evidence),
      documentIds: documents.map((document) => ({
        documentId: document.id,
        kind: document.metadata?.isMediaSummary
          ? 'overview'
          : document.metadata?.contentKind === 'media-chapter'
            ? 'chapter'
            : document.metadata?.contentKind === 'multimodal-segment'
              ? 'visual'
              : 'transcript',
        startSecs: Number.isFinite(Number(document.metadata?.startSecs))
          ? Number(document.metadata?.startSecs)
          : undefined,
        endSecs: Number.isFinite(Number(document.metadata?.endSecs))
          ? Number(document.metadata?.endSecs)
          : undefined,
      })),
    });
    if (evidence.videoEmbeddings?.length) {
      await upsertVideoEmbeddings(
        asset.id,
        knowledgeRun.revisionId,
        evidence.videoEmbeddings.map((embedding) => ({
          clipId: embedding.clipId,
          startSecs: embedding.startMs / 1_000,
          endSecs: embedding.endMs / 1_000,
          vector: embedding.vector,
          provider: embedding.provider,
        })),
      ).catch(() => undefined);
    }
    // The normal corpus vectors are ready after `ensureSearchable`; make the
    // evidence-level semantic vectors ready before exposing the video as ready
    // too. Otherwise immediate questions only have lexical retrieval until a
    // detached background task happens to finish.
    const semanticEvidenceReady = await primeSemanticEvidenceIndex(asset.id);
    if (!semanticEvidenceReady) {
      throw new Error(
        'Video evidence vectors could not be built. The asset remains unavailable until semantic retrieval is ready.',
      );
    }
    const published = await updateMediaAsset(asset.id, {
      processingStatus: 'completed',
      processingProgress: 100,
      processingMessage: undefined,
      caption: summary.slice(0, 600),
      durationSecs: preserveDurationSecs(asset, evidence.durationMs / 1_000),
      dimensions: { width: evidence.video.width, height: evidence.video.height },
      documentIds,
      pendingDocumentIds: [],
      supersededDocumentIds: asset.documentIds,
      activeVideoKnowledgeRevisionId: knowledgeRun.revisionId,
      activeVideoKnowledgeManifestId: activeManifest.id,
      videoRuntimeScope,
    });
    if (!published) throw new Error('Media asset was removed before indexing completed.');
    if (await cleanupDocumentRecords(asset.documentIds)) {
      await updateMediaAsset(asset.id, { supersededDocumentIds: [] }).catch(() => undefined);
    }
    void trackUsageEvent({
      type: 'media_processing',
      mediaType: 'video',
      mediaOperation: 'observation',
      durationSecs: evidence.durationMs / 1_000,
      frameCount: evidence.visualObservations.length,
      modelId: 'faster-whisper+paddleocr+yolox',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    if (knowledgeRun) {
      const message =
        error instanceof Error ? error.message : 'Video Intelligence processing failed.';
      const cancelled = /cancelled/i.test(message);
      await updateVideoKnowledgeRevision(knowledgeRun.revisionId, {
        status: cancelled ? 'cancelled' : 'failed',
      }).catch(() => {});
      await finishVideoKnowledgeJob(
        knowledgeRun.jobId,
        knowledgeRun.owner,
        cancelled ? 'cancelled' : 'failed',
        message,
      ).catch(() => {});
    }
    await rollbackPendingDocuments(asset.id, documentIds, indexAttempted);
    throw error;
  } finally {
    knowledgeRun?.release();
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Cloud quota is reserved before the GPU worker receives a job. New uploads
 * normally have browser metadata, while older assets may not. In that case we
 * only inspect the local container header with ffprobe; no frames, audio, OCR,
 * or video analysis run on the user's machine.
 */
async function ensureCloudVideoDuration(
  asset: MediaAsset,
  mediaPath: string,
  reportStage: StageReporter,
): Promise<MediaAsset> {
  if (Number.isFinite(asset.durationSecs) && (asset.durationSecs ?? 0) > 0) return asset;

  await reportStage('extract', {
    status: 'running',
    percent: 1,
    message: 'Reading video metadata for cloud quota reservation...',
  });
  const probe = await probeMedia(mediaPath);
  const durationSecs = Math.round(probe.durationSecs * 1_000) / 1_000;
  if (!Number.isFinite(durationSecs) || durationSecs <= 0) {
    throw new Error('Could not read the video duration needed for cloud quota reservation.');
  }
  await updateMediaAsset(asset.id, { durationSecs });
  return { ...asset, durationSecs };
}

async function fingerprintMediaFile(mediaPath: string): Promise<string> {
  const { createReadStream } = await import('node:fs');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(mediaPath)) hash.update(chunk);
  return hash.digest('hex');
}

async function assertVideoKnowledgeJobActive(run: { jobId: string } | undefined) {
  if (!run) return;
  const job = await getVideoKnowledgeJob(run.jobId);
  if (!job || job.cancellationRequestedAt)
    throw new Error('Video knowledge processing was cancelled.');
}

async function beginVideoKnowledgeRun(input: {
  asset: MediaAsset;
  mediaPath: string;
  durationSecs: number;
  maxDurationSecs: number;
  maxFrames: number;
  maxInspectionSpendUsd?: number;
}) {
  const sourceFingerprint = await fingerprintMediaFile(input.mediaPath);
  const pipelineVersion = 'video-knowledge-v1';
  const previousRevision = await findVideoKnowledgeRevision(
    input.asset.id,
    sourceFingerprint,
    pipelineVersion,
  );
  // A user-triggered reindex must never append new provider output into an
  // already-published revision. Keep the previous revision immutable and make
  // the new run independently auditable, even when the video bytes match.
  const revision = await createVideoKnowledgeRevision({
    mediaAssetId: input.asset.id,
    sourceFingerprint,
    pipelineVersion,
    parentRevisionId: previousRevision?.id,
    guidance: input.asset.indexingInstructions?.trim()
      ? { text: input.asset.indexingInstructions.trim(), createdAt: new Date().toISOString() }
      : undefined,
    budget: {
      maxDurationSecs: input.maxDurationSecs,
      maxBytes: input.asset.fileSize,
      maxFrames: input.maxFrames,
      maxModelCalls: 0,
      maxCostUsd: input.maxInspectionSpendUsd ?? 0,
      usedDurationSecs: input.durationSecs,
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
    idempotencyKey: `${input.asset.id}:${revision.id}:video-knowledge-v1`,
    budget: revision.budget,
  });
  const lease = await startLeasedVideoKnowledgeJob(job.id);
  if (!lease) throw new Error('Unable to claim the video knowledge job.');
  await lease.checkpoint('observing', { chunkIndex: 0 });
  return {
    revisionId: revision.id,
    jobId: job.id,
    owner: lease.owner,
    signal: lease.signal,
    release: lease.release,
  };
}

async function publishVideoKnowledge(input: {
  assetId: string;
  knowledgeRun: { revisionId: string; jobId: string; owner: string };
  segments: MediaEvidenceSegment[];
  transcriptChunks: Array<{ text: string; startSecs: number; endSecs: number }>;
  visualObservations: Array<{
    startSecs: number;
    endSecs: number;
    observations?: Array<{
      kind: 'object' | 'action' | 'ui' | 'chart' | 'relationship' | 'state';
      value: MetadataValue;
      frameTimestamps: number[];
      confidence: number;
      uncertaintyReasons: string[];
    }>;
  }>;
  ocrEvidence: OfflineKnowledgeEvidenceInput[];
  reconciledEvidence?: OfflineKnowledgeEvidenceInput[];
  documentIds: Array<{
    documentId: string;
    kind: 'overview' | 'chapter' | 'scene' | 'transcript' | 'visual';
    startSecs?: number;
    endSecs?: number;
  }>;
}) {
  const confidence = (score: number, reasons: string[] = []) => ({
    score: Math.max(0, Math.min(1, score)),
    source: 'provider' as const,
    calibrationStatus: 'uncalibrated' as const,
    uncertaintyReasons: reasons,
  });
  const evidence: OfflineKnowledgeEvidenceInput[] = [
    ...input.transcriptChunks
      .filter((chunk) => chunk.text.trim())
      .map((chunk) => ({
        modality: 'transcript' as const,
        timeRange: {
          startSecs: chunk.startSecs,
          endSecs: chunk.endSecs,
          precision: 'segment' as const,
        },
        payload: { text: chunk.text },
        source: { kind: 'provider' as const, provider: 'stt' },
        confidence: confidence(0.8, ['Transcript timing is provider-segment precision.']),
        observation: { kind: 'speech' as const, value: { text: chunk.text } },
      })),
    ...input.visualObservations.flatMap((sequence) =>
      (sequence.observations ?? []).map((observation) => ({
        modality: 'visual' as const,
        timeRange: {
          startSecs: Math.min(...observation.frameTimestamps),
          endSecs: Math.max(...observation.frameTimestamps),
          // FFmpeg seeking supplies an evidence timestamp, but not a verified
          // source PTS. Keep this estimated until a bounded precise inspection
          // has established the requested frame-level detail.
          precision: 'estimated' as const,
        },
        payload: { text: observation.value, frameTimestamps: observation.frameTimestamps },
        source: {
          kind: 'provider' as const,
          provider: 'configured-vision',
          version: 'structured-v1',
        },
        confidence: confidence(observation.confidence, observation.uncertaintyReasons),
        observation: {
          kind: observation.kind,
          value:
            observation.kind === 'state'
              ? parseStructuredState(observation.value)
              : { text: observation.value },
        },
      })),
    ),
    // Speech segments are already retained as transcript evidence. Persist
    // only discontinuities as audio events; duplicating every segment doubles
    // the knowledge graph and makes publication of long videos needlessly
    // slow without adding independent evidence.
    ...deriveAudioSignals(input.transcriptChunks)
      .filter((signal) => signal.silenceBoundary)
      .map((signal) => ({
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
        confidence: {
          ...confidence(0.5, ['Derived from transcript boundaries, not raw audio classification.']),
          source: 'heuristic' as const,
        },
        observation: {
          kind: 'audio-event' as const,
          value: {
            transcriptChange: signal.transcriptChange,
            silenceBoundary: signal.silenceBoundary,
          },
        },
      })),
    ...input.ocrEvidence,
    ...(input.reconciledEvidence ?? []),
  ];
  // A transcript-only asset remains useful; explicit evidence is preferable to
  // falling back to the legacy, free-text timeline bridge.
  if (evidence.length === 0) {
    throw new Error('No validated source evidence was produced for this media revision.');
  }
  const built = await buildVideoKnowledgeFromEvidence({
    mediaAssetId: input.assetId,
    knowledgeRevisionId: input.knowledgeRun.revisionId,
    evidence,
  });
  const projections = await saveVideoKnowledgeProjections(
    input.documentIds.map((document) => ({
      mediaAssetId: input.assetId,
      knowledgeRevisionId: input.knowledgeRun.revisionId,
      kind: document.kind,
      documentId: document.documentId,
      lineageIds: [],
      evidenceIds: built.evidenceIds,
      ...(document.startSecs !== undefined && document.endSecs !== undefined
        ? {
            timeRange: {
              startSecs: document.startSecs,
              endSecs: document.endSecs,
              precision: 'segment' as const,
            },
          }
        : {}),
      quality: {
        score: 0.7,
        source: 'heuristic',
        calibrationStatus: 'uncalibrated',
        uncertaintyReasons: ['Search projection; source evidence is authoritative.'],
      },
      active: false,
    })),
  );
  await checkpointVideoKnowledgeJob(
    input.knowledgeRun.jobId,
    input.knowledgeRun.owner,
    'projecting',
    {
      completedEvidenceIds: built.evidenceIds,
      completedProjectionIds: projections.map((projection) => projection.id),
    },
  );
  const manifest = await activateVideoKnowledgeManifest({
    mediaAssetId: input.assetId,
    knowledgeRevisionId: input.knowledgeRun.revisionId,
    activeEvidenceRevisionIds: Object.fromEntries(
      built.evidenceLineageIds.map((lineageId, index) => [lineageId, built.evidenceIds[index]]),
    ),
    activeObservationRevisionIds: Object.fromEntries(
      built.observationLineageIds.map((lineageId, index) => [
        lineageId,
        built.observationIds[index],
      ]),
    ),
    activeProjectionIds: projections.map((projection) => projection.id),
    activationReason: 'initial',
  });
  await updateVideoKnowledgeRevision(input.knowledgeRun.revisionId, {
    status: 'completed',
    activeManifestId: manifest.id,
    coverage: {
      sourceDurationSecs: Math.max(0, ...input.segments.map((segment) => segment.endSecs)),
      // A timeline window is a navigation projection, not proof that every
      // frame inside it was watched. Persist only the source intervals that
      // were actually transcribed or sampled so the agent can honestly decide
      // to rewind instead of treating sparse anchors as continuous coverage.
      inspectedRanges: [
        ...input.transcriptChunks.map((chunk) => ({
          startSecs: chunk.startSecs,
          endSecs: chunk.endSecs,
          precision: 'segment' as const,
        })),
        ...input.visualObservations.flatMap((sequence) =>
          (sequence.observations ?? []).flatMap((observation) =>
            observation.frameTimestamps.map((timestampSecs) => ({
              startSecs: timestampSecs,
              endSecs: timestampSecs,
              precision: 'estimated' as const,
            })),
          ),
        ),
        ...input.ocrEvidence.map((item) => item.timeRange),
      ],
      transcriptCoverage: coverageFraction(
        input.transcriptChunks.map((chunk) => ({
          startSecs: chunk.startSecs,
          endSecs: chunk.endSecs,
        })),
        Math.max(0, ...input.segments.map((segment) => segment.endSecs)),
      ),
      visualCoverage: coverageFraction(
        input.visualObservations.flatMap((sequence) =>
          (sequence.observations ?? []).flatMap((observation) =>
            observation.frameTimestamps.map((timestampSecs) => ({
              startSecs: timestampSecs,
              endSecs: timestampSecs,
            })),
          ),
        ),
        Math.max(0, ...input.segments.map((segment) => segment.endSecs)),
      ),
      ocrCoverage: coverageFraction(
        input.ocrEvidence.map((item) => ({
          startSecs: item.timeRange.startSecs,
          endSecs: item.timeRange.endSecs,
        })),
        Math.max(0, ...input.segments.map((segment) => segment.endSecs)),
      ),
      partialReasons: [
        'Visual understanding uses adaptive source anchors rather than continuous frame-by-frame observation.',
        'The raw source is retained so the agent can perform a bounded rewind when an answer needs stronger visual evidence.',
      ],
    },
  });
  await finishVideoKnowledgeJob(input.knowledgeRun.jobId, input.knowledgeRun.owner, 'completed');
  return manifest;
}

/**
 * OCR is performed anew for every indexing run.  Video Intelligence caching
 * is temporarily disabled so re-indexing never reuses a prior analyzer read.
 */
async function extractOfflineOcrEvidence(input: {
  mediaAssetId: string;
  knowledgeRevisionId: string;
  frames: Array<{ path: string; timestampSecs: number }>;
  maxFrames: number;
  signal: AbortSignal;
  concurrency?: number;
}): Promise<OfflineKnowledgeEvidenceInput[]> {
  const adapter = createConfiguredOcrAdapter();
  const step = Math.max(1, Math.ceil(input.frames.length / input.maxFrames));
  const selected = input.frames.filter((_, index) => index % step === 0).slice(0, input.maxFrames);
  const evidenceList = await mapConcurrent(selected, input.concurrency ?? 5, async (frame) => {
    try {
      if (input.signal.aborted) throw new Error('Video knowledge processing was cancelled.');
      const result = await adapter.recognize({ imagePath: frame.path, signal: input.signal });
      const payload: MetadataValue = {
        blocks: result.blocks.map((block) => ({
          text: block.text,
          left: block.left,
          top: block.top,
          width: block.width,
          height: block.height,
          confidence: block.confidence,
          ...(block.language ? { language: block.language } : {}),
          ...(block.direction ? { direction: block.direction } : {}),
        })),
        ...(result.provider ? { provider: result.provider } : {}),
        ...(result.model ? { model: result.model } : {}),
      };
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
      const payloadRecord = payload as Record<string, MetadataValue>;
      const blocks: MetadataValue[] = Array.isArray(payloadRecord.blocks)
        ? payloadRecord.blocks
        : [];
      const text = blocks
        .map((block: MetadataValue) =>
          block && typeof block === 'object' && !Array.isArray(block) ? block.text : '',
        )
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .join('\n');
      if (!text) return null;
      return {
        modality: 'ocr',
        timeRange: {
          startSecs: frame.timestampSecs,
          endSecs: frame.timestampSecs,
          precision: 'estimated',
        },
        payload,
        source: {
          kind: 'provider',
          provider:
            typeof payloadRecord.provider === 'string' ? payloadRecord.provider : 'configured-ocr',
          ...(typeof payloadRecord.model === 'string' ? { model: payloadRecord.model } : {}),
        },
        confidence: {
          score: Math.min(
            1,
            Math.max(
              0,
              blocks.reduce(
                (sum: number, block: MetadataValue) =>
                  sum +
                  (block &&
                  typeof block === 'object' &&
                  !Array.isArray(block) &&
                  typeof block.confidence === 'number'
                    ? block.confidence
                    : 0),
                0,
              ) / Math.max(1, blocks.length),
            ),
          ),
          source: 'provider',
          calibrationStatus: 'uncalibrated',
          uncertaintyReasons: ['OCR derived from a retained adaptive frame.'],
        },
        observation: { kind: 'ocr', value: { text } },
      } as OfflineKnowledgeEvidenceInput;
    } catch (error) {
      if (input.signal.aborted) throw error;
      console.warn(
        `[video] OCR skipped at ${formatTime(
          frame.timestampSecs,
        )} because the provider response was unusable.`,
        error,
      );
      return null;
    }
  });
  return evidenceList.filter((e): e is OfflineKnowledgeEvidenceInput => e !== null);
}

function parseStructuredState(value: MetadataValue): MetadataValue {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof value.subject === 'string' &&
    typeof value.property === 'string' &&
    value.value !== undefined
  ) {
    return { subject: value.subject, property: value.property, value: String(value.value) };
  }
  if (typeof value !== 'string') return { text: JSON.stringify(value) };
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (
      typeof parsed.subject === 'string' &&
      typeof parsed.property === 'string' &&
      parsed.value !== undefined
    ) {
      return { subject: parsed.subject, property: parsed.property, value: String(parsed.value) };
    }
  } catch {}
  return { text: value };
}

async function persistVideoFrameArtifacts(input: {
  mediaAssetId: string;
  knowledgeRevisionId: string;
  frames: Array<{ path: string; timestampSecs: number }>;
}) {
  const { readFile } = await import('node:fs/promises');
  await Promise.all(
    input.frames.map(async (frame) => {
      const bytes = await readFile(frame.path);
      const contentHash = createHash('sha256').update(bytes).digest('hex');
      const storageRef = createArtifactCacheKey({
        contentHash,
        operation: 'frame-artifact',
        schemaVersion: '1',
      });
      await appendFrameArtifact({
        mediaAssetId: input.mediaAssetId,
        knowledgeRevisionId: input.knowledgeRevisionId,
        storageRef,
        timestampSecs: frame.timestampSecs,
        width: 0,
        height: 0,
        contentHash,
        candidateSignals: {},
        selectionDecision: 'retained',
        selectionReason: 'adaptive-extraction',
      });
    }),
  );
}

/** Fraction of the source timeline with source-backed continuous evidence. */
function coverageFraction(
  ranges: Array<{ startSecs: number; endSecs: number }>,
  durationSecs: number,
): number {
  if (!Number.isFinite(durationSecs) || durationSecs <= 0) return 0;
  const ordered = ranges
    .filter((range) => Number.isFinite(range.startSecs) && Number.isFinite(range.endSecs))
    .map((range) => ({
      startSecs: Math.max(0, Math.min(durationSecs, range.startSecs)),
      endSecs: Math.max(0, Math.min(durationSecs, Math.max(range.startSecs, range.endSecs))),
    }))
    .sort((left, right) => left.startSecs - right.startSecs);
  let covered = 0;
  let active: { startSecs: number; endSecs: number } | undefined;
  for (const range of ordered) {
    if (!active || range.startSecs > active.endSecs) {
      if (active) covered += active.endSecs - active.startSecs;
      active = range;
    } else {
      active.endSecs = Math.max(active.endSecs, range.endSecs);
    }
  }
  if (active) covered += active.endSecs - active.startSecs;
  return Math.max(0, Math.min(1, covered / durationSecs));
}

function qualityToFrameInterval(quality: number | undefined, baseInterval: number): number {
  const q =
    typeof quality === 'number' && Number.isFinite(quality)
      ? Math.max(0, Math.min(100, quality))
      : 50;
  if (q <= 20) return Math.max(5, baseInterval * 2);
  if (q <= 40) return Math.max(5, Math.round(baseInterval * 1.5));
  if (q <= 60) return Math.max(5, baseInterval);
  if (q <= 80) return Math.max(5, Math.round(baseInterval * 0.6));
  return Math.max(3, Math.round(baseInterval * 0.4));
}

function qualityToMaxFrames(quality: number | undefined): number {
  const q =
    typeof quality === 'number' && Number.isFinite(quality)
      ? Math.max(0, Math.min(100, quality))
      : 50;
  if (q <= 20) return 100;
  if (q <= 40) return 250;
  if (q <= 60) return 600;
  if (q <= 80) return 900;
  return 1200;
}

function visualAnalysisWindow(durationSecs: number): number {
  if (durationSecs >= 4 * 60 * 60) return 15 * 60;
  if (durationSecs > 60 * 60) return 5 * 60;
  if (durationSecs > 30 * 60) return 3 * 60;
  if (durationSecs > 10 * 60) return 2 * 60;
  return 60;
}

function scopedApiUrl(pathname: string, requestUrl: string, serverId?: string): string {
  const url = new URL(pathname, requestUrl);
  if (serverId) url.searchParams.set('serverId', serverId);
  return url.toString();
}

async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await fn(items[index], index);
      }
    }),
  );
  return results;
}

function groupFramesByWindow<T extends { timestampSecs: number }>(
  frames: T[],
  windowSecs: number,
  maxImages: number,
): T[][] {
  const groups: T[][] = [];
  for (const frame of frames) {
    const current = groups.at(-1);
    if (
      !current ||
      current.length >= maxImages ||
      frame.timestampSecs - current[0].timestampSecs >= windowSecs
    ) {
      groups.push([frame]);
    } else {
      current.push(frame);
    }
  }
  return groups;
}

let indexChain: Promise<void> = Promise.resolve();

function ensureSearchable(
  onProgress?: (current: number, total: number, message: string) => void | Promise<void>,
  transcriptionProvider?: string,
): Promise<void> {
  const run = indexChain.then(async () => {
    const { readDocuments } = await import('@larkup/core/documents-store');
    const { createRun, runIndexer } = await import('@larkup/core/indexing/indexer');
    const { isRunning, readRun } = await import('@larkup/core/index-store');

    while (await isRunning()) {
      await onProgress?.(0, 0, 'Waiting for the active search-index job...');
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }

    const documents = await readDocuments();
    if (!documents.some((document) => document.status !== 'indexed')) {
      await onProgress?.(1, 1, 'Media is already searchable.');
      return;
    }

    const config = await readConfig();
    const previousRun = await readRun();
    let nextRun;
    while (!nextRun) {
      try {
        nextRun = await createRun(config);
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('already in progress'))
          throw error;
        await onProgress?.(0, 0, 'Waiting for the active search-index job...');
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
    await onProgress?.(
      0,
      0,
      `Building the searchable index with ${
        config.embeddingModelId || config.embeddingProvider
      }...`,
    );
    let indexingFinished = false;
    const indexing = runIndexer(
      nextRun.id,
      config,
      previousRun?.status === 'completed' ? previousRun : null,
    ).finally(() => {
      indexingFinished = true;
    });
    while (!indexingFinished) {
      const activeRun = await readRun();
      if (activeRun?.id === nextRun.id) {
        const total = activeRun.totalChunks ?? 0;
        const current = activeRun.processedChunks ?? 0;
        const phase =
          activeRun.status === 'chunking'
            ? 'Preparing searchable chunks'
            : activeRun.status === 'upserting'
              ? 'Saving vectors'
              : 'Embedding media evidence';
        await onProgress?.(
          current,
          total,
          total > 0 ? `${phase}: ${current} of ${total} chunks...` : `${phase}...`,
        );
      }
      await Promise.race([indexing, new Promise<void>((resolve) => setTimeout(resolve, 750))]);
    }
    await indexing;

    const completedRun = await readRun();
    if (completedRun?.id !== nextRun.id || completedRun.status !== 'completed') {
      throw describeSearchIndexFailure(
        completedRun?.error || 'Search indexing did not complete.',
        config,
        transcriptionProvider,
      );
    }
    await onProgress?.(
      completedRun.processedChunks,
      completedRun.totalChunks,
      `Media is searchable (${completedRun.processedChunks} chunks).`,
    );
  });

  indexChain = run.catch(() => {});
  return run;
}

function formatProviderName(provider: string): string {
  return provider === 'deepgram' ? 'Deepgram' : provider.replace(/_/g, ' ');
}

function describeSearchIndexFailure(
  error: string,
  config: Awaited<ReturnType<typeof readConfig>>,
  transcriptionProvider?: string,
): Error {
  const embeddingModel =
    config.embeddingModelId || config.embeddingProvider || 'your embedding model';
  if (/quota|billing|insufficient_quota/i.test(error)) {
    return new Error(
      `Transcription used ${formatProviderName(
        transcriptionProvider || 'the selected audio provider',
      )}. ` +
        `Semantic search then tried ${embeddingModel}, which has no available quota. ` +
        'Update the Embedding Model and API key in Settings → Models, then retry.',
    );
  }
  return new Error(error);
}

async function deleteIndexedDocuments(documentIds: string[]): Promise<void> {
  if (documentIds.length === 0) return;
  const config = await readConfig();
  const adapter = await createVectorAdapter(config);
  await adapter.deleteByDocumentIds(documentIds);
}

async function cleanupDocumentRecords(documentIds: string[]): Promise<boolean> {
  if (documentIds.length === 0) return true;
  try {
    await deleteIndexedDocuments(documentIds);
    await deleteDocuments(documentIds);
    return true;
  } catch (error) {
    console.error('Failed to remove tracked media documents:', error);
    return false;
  }
}

async function cleanupIncompleteMediaPublication(asset: MediaAsset): Promise<void> {
  const trackedIds = [
    ...new Set([...(asset.pendingDocumentIds ?? []), ...(asset.supersededDocumentIds ?? [])]),
  ];
  if (trackedIds.length === 0) return;
  if (!(await cleanupDocumentRecords(trackedIds))) {
    throw new Error(
      'A previous media-index generation still needs cleanup. Restore the vector-store connection and retry.',
    );
  }
  await updateMediaAsset(asset.id, {
    pendingDocumentIds: [],
    supersededDocumentIds: [],
  });
}

async function rollbackPendingDocuments(
  assetId: string,
  documentIds: string[],
  indexAttempted: boolean,
): Promise<void> {
  if (documentIds.length === 0) return;
  if (!indexAttempted) {
    await deleteDocuments(documentIds).catch((error) =>
      console.error('Failed to remove unpublished media documents:', error),
    );
    await updateMediaAsset(assetId, { pendingDocumentIds: [] }).catch(() => {});
    return;
  }

  if (await cleanupDocumentRecords(documentIds)) {
    await updateMediaAsset(assetId, { pendingDocumentIds: [] }).catch(() => {});
  } else {
    await updateMediaAsset(assetId, { pendingDocumentIds: documentIds }).catch(() => {});
  }
}

async function createVectorAdapter(config: Awaited<ReturnType<typeof readConfig>>) {
  const { createAdapter } = await import('@larkup/vector-stores/factory');
  return createAdapter(config);
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  timeoutMs = 90000,
): Promise<Response> {
  let response: Response | undefined;
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      response = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timeoutId);
      if (response.ok || (response.status !== 429 && response.status < 500)) return response;
      const retryAfterHeader = response.headers.get('retry-after');
      const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : Number.NaN;
      await response.body?.cancel().catch(() => {});
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Number.isFinite(retryAfter) ? retryAfter * 1_000 : (attempt + 1) * 1_500,
        ),
      );
    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 1_500));
    }
  }
  if (response) return response;
  throw lastError instanceof Error ? lastError : new Error('Visual sequence request failed.');
}

async function trackMediaProcessing(
  mediaType: 'video' | 'audio',
  durationSecs: number,
  frameCount: number,
  provider: string,
) {
  const { trackUsageEvent } = await import('@larkup/core/analytics-store');
  void trackUsageEvent({
    type: 'media_processing',
    mediaType,
    modelId: provider === 'local' ? 'local-whisper' : provider,
    durationSecs,
    frameCount,
    estimatedCost: provider !== 'local' ? (durationSecs / 60) * 0.006 : 0,
    timestamp: new Date().toISOString(),
  });
}
