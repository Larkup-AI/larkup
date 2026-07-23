import { NextResponse } from 'next/server';
import { claimMediaAsset, updateMediaAsset, readMediaAssets } from '@larkup/core/media-store';
import { addDocument, deleteDocuments } from '@larkup/core/documents-store';
import { getInstalledTool, isToolInstalled } from '@larkup/marketplace/installer';
import { loadTool } from '@larkup/marketplace/loader';
import { createStorageProvider } from '@larkup/marketplace/storage';
import { readConfig } from '@larkup/core/config-store';
import type { MediaAsset } from '@larkup/core/types';
import { getConcurrencyLimits } from '@/lib/os-concurrency';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// One lightweight in-process queue per app instance prevents different users
// from launching several memory-heavy FFmpeg jobs at once.
let mediaProcessingChain: Promise<void> = Promise.resolve();

/**
 * POST → trigger media processing for one or more assets.
 *
 * Body: { assetIds: string[] }
 *
 * Processing is claimed atomically and continues in the background while the
 * client polls persisted asset progress.
 * For images: generates captions via vision LLM.
 * For video/audio: requires the Video & Audio tool to be installed.
 */
export async function POST(req: Request) {
  try {
    const { assetIds } = (await req.json()) as { assetIds: string[] };
    if (!assetIds?.length) {
      return NextResponse.json({ error: 'assetIds required' }, { status: 400 });
    }

    const assets = await readMediaAssets();
    const matchingAssets = assets.filter((asset) => assetIds.includes(asset.id));
    const claimedAssets = await Promise.all(
      matchingAssets.map((asset) => claimMediaAsset(asset.id)),
    );
    const toProcess = claimedAssets.filter((asset): asset is MediaAsset => Boolean(asset));
    const sourceTranscripts = new Map<string, any>();

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

    const reqUrl = req.url;

    // Run processing in the background
    const job = mediaProcessingChain.then(async () => {
      for (const initialAsset of toProcess) {
        let currentAsset = initialAsset;
        let heartbeat: ReturnType<typeof setInterval> | undefined;
        let lastProgressUpdate = 0;
        let lastProgressMessage = '';
        const setProgress = async (msg: string, progress?: number) => {
          const now = Date.now();
          // FFmpeg can emit dozens of progress events per second. Persist enough
          // updates for a responsive UI without turning progress into disk churn.
          if (msg === lastProgressMessage && now - lastProgressUpdate < 750) return;
          lastProgressUpdate = now;
          lastProgressMessage = msg;
          await updateMediaAsset(currentAsset.id, {
            processingMessage: msg,
            processingProgress: progress,
          });
        };

        try {
          await updateMediaAsset(currentAsset.id, {
            processingStatus: 'processing',
            processingError: undefined,
            processingMessage: 'Starting process...',
            processingProgress: 2,
          });
          heartbeat = setInterval(() => {
            void updateMediaAsset(currentAsset.id, {}).catch(() => {});
          }, 60_000);

          if (currentAsset.storageUri.startsWith('pending://') && currentAsset.originalUrl) {
            await setProgress('Downloading from URL...', 5);
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
                  ...storedFirstEntry,
                  processingMessage: 'Download complete...',
                  processingProgress: 12,
                })) || currentAsset;
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
                extraAssets.forEach((extraAsset, index) => {
                  const transcript = entries[index + 1]?.sourceTranscript;
                  if (transcript?.chunks?.length) sourceTranscripts.set(extraAsset.id, transcript);
                });
                // Push them to the queue to be processed in this loop
                toProcess.push(...extraAssets);
              }
            } finally {
              await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
            }
          }

          if (currentAsset.type === 'image') {
            await setProgress(`Processing image: ${currentAsset.fileName}`, 20);
            await processImageAsset(currentAsset, reqUrl);
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
              setProgress,
              sourceTranscripts.get(currentAsset.id),
            );
          } else {
            throw new Error('Unsupported media type');
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Processing failed';
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
    });
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

async function processImageAsset(asset: MediaAsset, reqUrl: string): Promise<void> {
  let caption = `Image: ${asset.fileName}`;

  try {
    const storage = createStorageProvider();
    const fileData = await storage.retrieve(asset.storageUri);
    const base64 = fileData.toString('base64');

    const descRes = await fetch(new URL('/api/describe-image', reqUrl).toString(), {
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

  const doc = await addDocument({
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

  try {
    await ensureSearchable();
    await updateMediaAsset(asset.id, {
      processingStatus: 'completed',
      processingProgress: 100,
      processingMessage: undefined,
      caption,
      documentIds: [doc.id],
    });
    await cleanupReplacedDocuments(asset.documentIds);
  } catch (error) {
    await deleteIndexedDocuments([doc.id]).catch(() => {});
    await deleteDocuments([doc.id]);
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/* Video/Audio processing (requires marketplace tool)                  */
/* ------------------------------------------------------------------ */

async function processMediaWithTool(
  asset: MediaAsset,
  reqUrl: string,
  onProgress?: (msg: string, progress?: number) => void,
  sourceTranscript?: { chunks: any[]; fullText: string; durationSecs: number },
): Promise<void> {
  const tool = await loadTool<any>('video-audio');
  if (!tool) {
    throw new Error('Failed to load Video & Audio tool');
  }

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
      typeof toolConfig.audioLanguage === 'string' ? toolConfig.audioLanguage : undefined;
    const localUrl = `/api/media/${asset.id}`;

    const limits = getConcurrencyLimits();

    if (asset.type === 'video' && tool.processVideo) {
      onProgress?.(`Extracting keyframes and audio (Threads: ${limits.ffmpegThreads})...`, 15);
      const result = await tool.processVideo(tmpFile, {
        outputDir: tmpDir,
        frameIntervalSecs,
        // The previous fixed cap of 40 left multi-hour videos almost entirely
        // unseen. Scene detection keeps this bounded while preserving coverage.
        maxFrames: 600,
        threads: limits.ffmpegThreads,
        parallelExtraction: limits.canParallelizeFfmpeg,
        skipAudioExtraction: Boolean(sourceTranscript?.chunks.length),
        onProgress: (value: number) => {
          void onProgress?.(
            `Extracting keyframes and audio (${Math.round(value)}%)...`,
            15 + Math.round(Math.max(0, Math.min(1, value)) * 10),
          );
        },
      });

      let transcriptPromise: Promise<any | null> = Promise.resolve(sourceTranscript ?? null);

      // Process audio transcript
      if (!sourceTranscript && result.audioPath && tool.processAudio) {
        transcriptPromise = (async () => {
          onProgress?.('Transcribing and timestamping the audio track...', 25);
          return await tool.processAudio(result.audioPath, { provider, apiKey, language });
        })();
      }

      // Analyze consecutive frames together so the vision model can infer
      // actions, transitions, and persistent on-screen text rather than seeing
      // every frame as an unrelated image.
      const scenePromise = (async () => {
        onProgress?.('Linking consecutive frames into visual sequences...', 30);
        const extractedFrames = result.frames as { path: string; timestampSecs: number }[];
        const frameGroups = groupFramesByWindow(extractedFrames, 60, 4);
        let analyzed = 0;
        return await mapConcurrent(
          frameGroups,
          limits.apiConcurrency,
          async (frames: { path: string; timestampSecs: number }[]) => {
            const base64Images = await Promise.all(
              frames.map(async (frame) => (await fs.readFile(frame.path)).toString('base64')),
            );
            const startSecs = Math.floor(frames[0].timestampSecs / 60) * 60;
            const endSecs = Math.min(startSecs + 60, result.meta.durationSecs);
            const timestamps = frames.map((frame) => formatTime(frame.timestampSecs)).join(', ');
            const descRes = await fetchWithRetry(
              new URL('/api/describe-image', reqUrl).toString(),
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  base64Images,
                  prompt: `These images are chronological video frames at ${timestamps}. Describe the sequence as one timeline for semantic search. Identify people when visually supported; explain actions, interactions, state changes, results or winners, important objects, and all meaningful readable on-screen text/OCR. Distinguish what persists from what changes. Be factual and concise (maximum 6 sentences).`,
                }),
              },
            );
            analyzed++;
            const progressStep = Math.max(1, Math.ceil(frameGroups.length / 100));
            if (analyzed % progressStep === 0 || analyzed === frameGroups.length) {
              onProgress?.(
                `Understanding visual sequence ${analyzed} of ${frameGroups.length}...`,
                30 + Math.round((analyzed / Math.max(frameGroups.length, 1)) * 35),
              );
            }
            if (!descRes.ok) {
              throw new Error(`Visual sequence analysis failed (${descRes.status}).`);
            }
            const { description } = (await descRes.json()) as { description?: string };
            return description
              ? { text: description, startSecs, endSecs: Math.max(startSecs + 1, endSecs) }
              : null;
          },
        );
      })();

      const [transcript, sceneDescriptions] = await Promise.all([transcriptPromise, scenePromise]);
      onProgress?.('Aligning speech, actions, OCR, and neighboring frames...', 68);

      const validScenes = sceneDescriptions.filter(
        (scene): scene is NonNullable<typeof scene> => scene !== null,
      );
      const segments = tool.buildMultimodalSegments(
        transcript?.chunks ?? [],
        validScenes,
        result.meta.durationSecs,
        60,
      );

      if (segments.length === 0) {
        throw new Error('No searchable speech or visual evidence was produced from this video.');
      }

      onProgress?.('Saving the searchable video timeline...', 75);
      const document = await addDocument({
        title: asset.fileName,
        content: buildMediaTimeline('Video', asset.fileName, segments),
        source: 'media',
        url: localUrl,
        metadata: {
          mediaAssetId: asset.id,
          mediaType: 'video',
          fileName: asset.fileName,
          mediaUrl: localUrl,
          originalUrl: asset.originalUrl,
          durationSecs: result.meta.durationSecs,
          contentKind: 'multimodal-timeline',
          segmentCount: segments.length,
          transcriptSource: sourceTranscript ? 'source-captions' : 'speech-to-text',
        },
      });
      documentIds.push(document.id);

      onProgress?.('Embedding linked segments for semantic search...', 85);
      await ensureSearchable(onProgress);
      await updateMediaAsset(asset.id, {
        processingStatus: 'completed',
        caption: `Video: ${result.meta.durationSecs.toFixed(0)}s, ${
          result.frames.length
        } frames extracted`,
        durationSecs: result.meta.durationSecs,
        dimensions: { width: result.meta.width, height: result.meta.height },
        documentIds,
        processingProgress: 100,
        processingMessage: undefined,
      });
      published = true;
      await cleanupReplacedDocuments(asset.documentIds);
      await trackMediaProcessing('video', result.meta.durationSecs, result.frames.length, provider);
    } else if (asset.type === 'audio' && tool.processAudio) {
      onProgress?.('Transcribing and timestamping the audio track...', 20);
      const transcript = await tool.processAudio(tmpFile, { provider, apiKey, language });
      const segments = tool.buildMultimodalSegments(
        transcript.chunks,
        [],
        transcript.durationSecs,
        60,
      );
      onProgress?.('Linking neighboring transcript segments...', 70);
      if (segments.length === 0) {
        throw new Error('The transcription completed without searchable speech.');
      }

      onProgress?.('Saving the searchable audio transcript...', 80);
      const document = await addDocument({
        title: asset.fileName,
        content: buildMediaTimeline('Audio', asset.fileName, segments),
        source: 'media',
        url: localUrl,
        metadata: {
          mediaAssetId: asset.id,
          mediaType: 'audio',
          fileName: asset.fileName,
          mediaUrl: localUrl,
          originalUrl: asset.originalUrl,
          durationSecs: transcript.durationSecs,
          contentKind: 'audio-transcript',
          segmentCount: segments.length,
        },
      });
      documentIds.push(document.id);

      onProgress?.('Embedding linked segments for semantic search...', 85);
      await ensureSearchable(onProgress);
      await updateMediaAsset(asset.id, {
        processingStatus: 'completed',
        caption: `Audio: ${transcript.durationSecs.toFixed(0)}s, ${
          transcript.chunks.length
        } segments`,
        durationSecs: transcript.durationSecs,
        documentIds,
        processingProgress: 100,
        processingMessage: undefined,
      });
      published = true;
      await cleanupReplacedDocuments(asset.documentIds);
      await trackMediaProcessing('audio', transcript.durationSecs, 0, provider);
    }
  } catch (error) {
    if (!published) {
      await deleteIndexedDocuments(documentIds).catch(() => {});
      await deleteDocuments(documentIds);
    }
    throw error;
  } finally {
    // Clean up temp files
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function buildMediaTimeline(
  mediaLabel: 'Video' | 'Audio',
  fileName: string,
  segments: Array<{ text: string; startSecs: number; endSecs: number }>,
): string {
  return [
    `${mediaLabel}: ${fileName}`,
    ...segments.map(
      (segment) =>
        `## ${formatTime(segment.startSecs)} – ${formatTime(segment.endSecs)}\n${segment.text}`,
    ),
  ].join('\n\n');
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

function ensureSearchable(onProgress?: (msg: string, progress?: number) => void): Promise<void> {
  const run = indexChain.then(async () => {
    const { readDocuments } = await import('@larkup/core/documents-store');
    const { createRun, runIndexer } = await import('@larkup/core/indexing/indexer');
    const { isRunning, readRun } = await import('@larkup/core/index-store');

    while (await isRunning()) {
      onProgress?.('Waiting for the active search-index job...', 88);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }

    const documents = await readDocuments();
    if (!documents.some((document) => document.status !== 'indexed')) return;

    const config = await readConfig();
    const previousRun = await readRun();
    let nextRun;
    while (!nextRun) {
      try {
        nextRun = await createRun(config);
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('already in progress'))
          throw error;
        onProgress?.('Waiting for the active search-index job...', 88);
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
    onProgress?.('Building the searchable multimodal index...', 90);
    await runIndexer(nextRun.id, config, previousRun?.status === 'completed' ? previousRun : null);

    const completedRun = await readRun();
    if (completedRun?.id !== nextRun.id || completedRun.status !== 'completed') {
      throw new Error(completedRun?.error || 'Search indexing did not complete.');
    }
    onProgress?.('Media is searchable.', 99);
  });

  indexChain = run.catch(() => {});
  return run;
}

async function deleteIndexedDocuments(documentIds: string[]): Promise<void> {
  if (documentIds.length === 0) return;
  const config = await readConfig();
  const adapter = await createVectorAdapter(config);
  await adapter.deleteByDocumentIds(documentIds);
}

async function cleanupReplacedDocuments(documentIds: string[]): Promise<void> {
  if (documentIds.length === 0) return;
  try {
    await deleteIndexedDocuments(documentIds);
    await deleteDocuments(documentIds);
  } catch (error) {
    console.error('Failed to remove replaced media documents:', error);
  }
}

async function createVectorAdapter(config: Awaited<ReturnType<typeof readConfig>>) {
  const { createAdapter } = await import('@larkup/vector-stores/factory');
  return createAdapter(config);
}

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let response: Response | undefined;
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      response = await fetch(url, init);
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
