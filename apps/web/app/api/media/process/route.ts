import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import {
  claimMediaAsset,
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
import type { MediaAsset, MediaPipelineStage } from '@larkup/core/types';
import { runWithServer } from '@larkup/core/workspace';
import { getConcurrencyLimits } from '@/lib/os-concurrency';
import {
  buildMediaDocumentInputs,
  createFallbackMediaSummary,
  createMediaKnowledgeSummary,
  formatTime,
  type MediaEvidenceSegment,
} from '@/lib/media-knowledge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// One lightweight in-process queue per app instance prevents different users
// from launching several memory-heavy FFmpeg jobs at once.
let mediaProcessingChain: Promise<void> = Promise.resolve();

type StageReporter = (stage: MediaPipelineStage, patch: MediaProcessingStepPatch) => Promise<void>;

/**
 * POST → trigger media processing for one or more assets.
 *
 * Body: { assetIds: string[], serverId?: string }
 *
 * Processing is claimed atomically and continues in the background while the
 * client polls persisted asset progress.
 * For images: generates captions via vision LLM.
 * For video/audio: requires the Video & Audio tool to be installed.
 */
export async function POST(req: Request) {
  try {
    const { assetIds, serverId } = (await req.json()) as {
      assetIds: string[];
      serverId?: string;
    };
    if (!assetIds?.length) {
      return NextResponse.json({ error: 'assetIds required' }, { status: 400 });
    }
    const enqueue = () => enqueueMediaProcessing(req.url, assetIds, serverId);
    return serverId ? await runWithServer(serverId, enqueue) : await enqueue();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to trigger processing';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function enqueueMediaProcessing(
  reqUrl: string,
  assetIds: string[],
  serverId?: string,
): Promise<NextResponse> {
  try {
    const assets = await readMediaAssets();
    const matchingAssets = assets.filter((asset) => assetIds.includes(asset.id));
    const claimedAssets = await Promise.all(
      matchingAssets.map((asset) => claimMediaAsset(asset.id)),
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
      void (serverId ? runWithServer(serverId, touch) : touch()).catch(() => {});
    }, 60_000);

    // Run processing in the background
    const runJob = async () => {
      for (const initialAsset of toProcess) {
        queuedAssetIds.delete(initialAsset.id);
        let currentAsset = initialAsset;
        let heartbeat: ReturnType<typeof setInterval> | undefined;
        const activeStages = new Set<MediaPipelineStage>();
        const lastStageUpdates = new Map<MediaPipelineStage, number>();
        const reportStage: StageReporter = async (stage, patch) => {
          const now = Date.now();
          const isTerminal =
            patch.status === 'completed' || patch.status === 'skipped' || patch.status === 'failed';
          // FFmpeg and providers can report many events per second. Each stage
          // keeps its own throttle so parallel transcription and vision never
          // overwrite or suppress one another.
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
          await updateMediaStage(currentAsset.id, stage, patch);
        };

        try {
          const startedAsset = await updateMediaAsset(currentAsset.id, {
            processingStatus: 'processing',
            processingError: undefined,
            processingMessage: 'Starting process...',
            processingProgress: 2,
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
            const tool = await loadTool<any>('video-audio');
            if (!tool || !tool.importMediaUrl)
              throw new Error('Video & Audio tool not properly installed.');

            const { promises: fs } = await import('node:fs');
            const path = await import('node:path');
            const os = await import('node:os');
            const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'larkup-url-media-'));
            try {
              const entries = await tool.importMediaUrl(currentAsset.originalUrl, {
                outputDir: tmpDir,
                playlistMax: 10, // max items
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

              // Process the first entry into the current asset
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

              // If playlist, insert the rest as new pending assets and process them later
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
                // Push them to the queue to be processed in this loop
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
            const installed = await isToolInstalled('video-audio');
            if (!installed) {
              throw new Error(
                'Video & Audio tool is not installed. Install it from the Marketplace.',
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
      .then(() => (serverId ? runWithServer(serverId, runJob) : runJob()))
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

/* ------------------------------------------------------------------ */
/* Image processing (built-in, no tool needed)                         */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* Video/Audio processing (requires marketplace tool)                  */
/* ------------------------------------------------------------------ */

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
  const tool = await loadTool<any>('video-audio');
  if (!tool) {
    throw new Error('Failed to load Video & Audio tool');
  }
  await cleanupIncompleteMediaPublication(asset);

  const storage = createStorageProvider();

  // Process local media in place so multi-hour files are not duplicated in
  // Node.js memory. Other storage providers retain the buffered fallback.
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

  try {
    const installedTool = await getInstalledTool('video-audio');
    const globalConfig = await readConfig();
    const toolConfig = globalConfig.toolConfigs?.['video-audio'] || {};
    const provider = typeof toolConfig.audioProvider === 'string' ? toolConfig.audioProvider : '';
    const apiKey = typeof toolConfig.audioApiKey === 'string' ? toolConfig.audioApiKey : '';
    if (!provider) {
      throw new Error(
        'Choose an Audio Provider in Settings → Marketplace Tools → Video & Audio before indexing media.',
      );
    }
    if (provider !== 'local' && !apiKey) {
      throw new Error(
        'Add the API key for the selected Audio Provider in Settings → Marketplace Tools → Video & Audio.',
      );
    }
    const frameIntervalSecs = Math.max(5, Number(installedTool?.config?.frameInterval ?? 30) || 30);
    const language =
      typeof toolConfig.audioLanguage === 'string' ? toolConfig.audioLanguage : 'auto';
    const effectiveLanguage =
      language.trim().toLowerCase() === 'auto' && sourceTranscript?.language
        ? sourceTranscript.language
        : language;
    const localUrl = `/api/media/${asset.id}`;

    const limits = getConcurrencyLimits();

    if (asset.type === 'video' && tool.processVideo) {
      const sourceKind = sourceTranscript?.origin?.kind;
      const hasManualSourceTranscript =
        Boolean(sourceTranscript?.chunks?.length) && sourceKind !== 'youtube-auto';
      await reportStage('extract', {
        status: 'running',
        percent: 0,
        message: `Extracting adaptive frames and audio (${limits.ffmpegThreads} FFmpeg threads)...`,
      });
      const result = await tool.processVideo(tmpFile, {
        outputDir: tmpDir,
        frameIntervalSecs,
        maxFrames: 600,
        threads: limits.ffmpegThreads,
        parallelExtraction: limits.canParallelizeFfmpeg,
        // Manual captions can be authoritative. Automatic captions remain a
        // fallback and must not silently bypass the configured audio provider.
        skipAudioExtraction: hasManualSourceTranscript,
        onProgress: (value: number) => {
          void reportStage('extract', {
            status: 'running',
            percent: Math.round(Math.max(0, Math.min(1, value)) * 100),
            message: `Extracting adaptive frames and audio (${Math.round(value * 100)}%)...`,
          }).catch(() => {});
        },
      });
      await reportStage('extract', {
        status: 'completed',
        current: result.frames.length,
        total: result.frames.length,
        unit: 'frames',
        message: `Extracted ${result.frames.length} adaptive frames and the audio track.`,
      });

      let transcriptPromise: Promise<any | null> = Promise.resolve(
        hasManualSourceTranscript ? sourceTranscript : null,
      );

      // Process audio transcript
      if (hasManualSourceTranscript) {
        await reportStage('transcribe', {
          status: 'completed',
          current: sourceTranscript?.chunks.length,
          total: sourceTranscript?.chunks.length,
          unit: 'caption sections',
          message: 'Using timestamped manual source captions.',
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

      // Analyze consecutive frames together so the vision model can infer
      // actions, transitions, and persistent on-screen text rather than seeing
      // every frame as an unrelated image.
      const scenePromise = (async () => {
        const extractedFrames = result.frames as { path: string; timestampSecs: number }[];
        const analysisWindowSecs = visualAnalysisWindow(result.meta.durationSecs);
        const frameGroups = groupFramesByWindow(extractedFrames, analysisWindowSecs, 6);
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
        const descriptions = await mapConcurrent(
          frameGroups,
          limits.apiConcurrency,
          async (frames: { path: string; timestampSecs: number }[]) => {
            const base64Images = await Promise.all(
              frames.map(async (frame) => (await fs.readFile(frame.path)).toString('base64')),
            );
            const startSecs = frames[0].timestampSecs;
            const endSecs = Math.min(
              result.meta.durationSecs,
              Math.max(startSecs + 1, frames.at(-1)!.timestampSecs + frameIntervalSecs),
            );
            const timestamps = frames.map((frame) => formatTime(frame.timestampSecs)).join(', ');
            const descRes = await fetchWithRetry(
              scopedApiUrl('/api/describe-image', reqUrl, serverId),
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  base64Images,
                  prompt: `These are chronological frames from "${asset.fileName}" at ${timestamps}.
Write one evidence note for this time range. Track people, actions, interactions, state changes,
important objects, and exact meaningful on-screen text. Perform careful OCR, including Arabic and
other right-to-left text without reversing labels. For scoreboards or result animations, compare
frames in timestamp order and report the latest visible score as the current/final state; associate
each number with the correct nearby team/person label. Record a winner or result only when visually
supported. Omit boilerplate about facts that are not shown. Be factual, information-dense, and
concise.`,
                }),
              },
            );
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
            if (!descRes.ok) {
              let detail = '';
              try {
                const errorBody = (await descRes.json()) as { error?: string };
                detail = errorBody.error?.trim() || '';
              } catch {
                // Keep the status-only fallback for non-JSON failures.
              }
              throw new Error(
                `Visual sequence analysis failed (${descRes.status})${
                  detail ? `: ${detail}` : '.'
                }`,
              );
            }
            const { description } = (await descRes.json()) as { description?: string };
            return description
              ? { text: description, startSecs, endSecs: Math.max(startSecs + 1, endSecs) }
              : null;
          },
        );
        await reportStage('vision', {
          status: 'completed',
          current: frameGroups.length,
          total: frameGroups.length,
          unit: 'sequences',
          message: `Understood ${frameGroups.length} visual sequences with OCR.`,
        });
        return descriptions;
      })();

      const [transcript, sceneDescriptions] = await Promise.all([transcriptPromise, scenePromise]);

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
      }).map((input) => ({ ...input, id: randomUUID() }));
      documentIds.push(...documentInputs.map((input) => input.id));
      if (!(await updateMediaAsset(asset.id, { pendingDocumentIds: documentIds }))) {
        throw new Error('Media asset was removed before its evidence could be published.');
      }
      const documents = await addDocuments(documentInputs);

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
      const publishedAsset = await updateMediaAsset(asset.id, {
        processingStatus: 'completed',
        caption: summary.slice(0, 600),
        durationSecs: result.meta.durationSecs,
        dimensions: { width: result.meta.width, height: result.meta.height },
        documentIds,
        pendingDocumentIds: [],
        supersededDocumentIds: asset.documentIds,
        processingProgress: 100,
        processingMessage: undefined,
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
      }).map((input) => ({ ...input, id: randomUUID() }));
      documentIds.push(...documentInputs.map((input) => input.id));
      if (!(await updateMediaAsset(asset.id, { pendingDocumentIds: documentIds }))) {
        throw new Error('Media asset was removed before its evidence could be published.');
      }
      const documents = await addDocuments(documentInputs);

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
      const publishedAsset = await updateMediaAsset(asset.id, {
        processingStatus: 'completed',
        caption: summary.slice(0, 600),
        durationSecs: transcript.durationSecs,
        documentIds,
        pendingDocumentIds: [],
        supersededDocumentIds: asset.documentIds,
        processingProgress: 100,
        processingMessage: undefined,
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
    if (!published) {
      await rollbackPendingDocuments(asset.id, documentIds, indexAttempted);
    }
    throw error;
  } finally {
    // Clean up temp files
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

function visualAnalysisWindow(durationSecs: number): number {
  if (durationSecs >= 4 * 60 * 60) return 15 * 60;
  if (durationSecs > 60 * 60) return 5 * 60;
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

// Serialize index updates from concurrent media workers. This keeps vector
// writes bounded and guarantees an asset is only marked complete after its
// timeline is actually searchable.
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
    // Keep the IDs durably attached to the asset. A retry or deletion can then
    // remove partial vectors before publishing a new generation.
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
