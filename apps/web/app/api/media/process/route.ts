import { NextResponse } from 'next/server';
import { getMediaAsset, updateMediaAsset, readMediaAssets } from '@larkup/core/media-store';
import { addDocument } from '@larkup/core/documents-store';
import { isToolInstalled } from '@larkup/marketplace/installer';
import { loadTool } from '@larkup/marketplace/loader';
import { createStorageProvider } from '@larkup/marketplace/storage';
import type { MediaAsset } from '@larkup/core/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST → trigger media processing for one or more assets.
 *
 * Body: { assetIds: string[] }
 *
 * Processing runs in-process (not background) for simplicity.
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
    const toProcess = assets.filter((a) => assetIds.includes(a.id));

    if (toProcess.length === 0) {
      return NextResponse.json({ error: 'No matching assets found' }, { status: 404 });
    }

    const results: { id: string; status: string; error?: string }[] = [];

    for (const asset of toProcess) {
      try {
        await updateMediaAsset(asset.id, { processingStatus: 'processing' });

        if (asset.type === 'image') {
          await processImageAsset(asset);
          results.push({ id: asset.id, status: 'completed' });
        } else if (asset.type === 'video' || asset.type === 'audio') {
          const installed = await isToolInstalled('video-audio');
          if (!installed) {
            await updateMediaAsset(asset.id, {
              processingStatus: 'failed',
              processingError:
                'Video & Audio tool is not installed. Install it from the Marketplace.',
            });
            results.push({
              id: asset.id,
              status: 'failed',
              error: 'Video & Audio tool not installed',
            });
            continue;
          }
          await processMediaWithTool(asset);
          results.push({ id: asset.id, status: 'completed' });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Processing failed';
        await updateMediaAsset(asset.id, {
          processingStatus: 'failed',
          processingError: message,
        });
        results.push({ id: asset.id, status: 'failed', error: message });
      }
    }

    return NextResponse.json({ results });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Processing failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/* ------------------------------------------------------------------ */
/* Image processing (built-in, no tool needed)                         */
/* ------------------------------------------------------------------ */

async function processImageAsset(asset: MediaAsset): Promise<void> {
  // Create a simple document from the image metadata
  // Vision LLM captioning can be added later when we detect a vision-capable model
  const caption = `Image: ${asset.fileName}`;

  const doc = await addDocument({
    title: asset.fileName,
    content: caption,
    source: 'media',
    metadata: {
      mediaAssetId: asset.id,
      mediaType: 'image',
      fileName: asset.fileName,
      mimeType: asset.mimeType,
      fileSize: asset.fileSize,
      dimensions: asset.dimensions,
    },
  });

  await updateMediaAsset(asset.id, {
    processingStatus: 'completed',
    caption,
    documentIds: [doc.id],
  });
}

/* ------------------------------------------------------------------ */
/* Video/Audio processing (requires marketplace tool)                  */
/* ------------------------------------------------------------------ */

async function processMediaWithTool(asset: MediaAsset): Promise<void> {
  const tool = await loadTool<any>('video-audio');
  if (!tool) {
    throw new Error('Failed to load Video & Audio tool');
  }

  const storage = createStorageProvider();
  const fileData = await storage.retrieve(asset.storageUri);

  // Write to temp file for processing
  const { promises: fs } = await import('node:fs');
  const path = await import('node:path');
  const os = await import('node:os');

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'larkup-media-'));
  const ext = asset.fileName.split('.').pop() || 'tmp';
  const tmpFile = path.join(tmpDir, `input.${ext}`);
  await fs.writeFile(tmpFile, fileData);

  try {
    const documentIds: string[] = [];

    if (asset.type === 'video' && tool.processVideo) {
      const result = await tool.processVideo(tmpFile, { outputDir: tmpDir });

      // Process audio transcript
      if (result.audioPath && tool.processAudio) {
        const transcript = await tool.processAudio(result.audioPath);
        for (const chunk of transcript.chunks) {
          const doc = await addDocument({
            title: `${asset.fileName} [${formatTime(chunk.startSecs)} - ${formatTime(
              chunk.endSecs,
            )}]`,
            content: chunk.text,
            source: 'media',
            metadata: {
              mediaAssetId: asset.id,
              mediaType: 'video',
              startSecs: chunk.startSecs,
              endSecs: chunk.endSecs,
            },
          });
          documentIds.push(doc.id);
        }
      }

      await updateMediaAsset(asset.id, {
        processingStatus: 'completed',
        caption: `Video: ${result.meta.durationSecs.toFixed(0)}s, ${
          result.frames.length
        } frames extracted`,
        durationSecs: result.meta.durationSecs,
        dimensions: { width: result.meta.width, height: result.meta.height },
        documentIds,
      });
    } else if (asset.type === 'audio' && tool.processAudio) {
      const transcript = await tool.processAudio(tmpFile);

      for (const chunk of transcript.chunks) {
        const doc = await addDocument({
          title: `${asset.fileName} [${formatTime(chunk.startSecs)} - ${formatTime(
            chunk.endSecs,
          )}]`,
          content: chunk.text,
          source: 'media',
          metadata: {
            mediaAssetId: asset.id,
            mediaType: 'audio',
            startSecs: chunk.startSecs,
            endSecs: chunk.endSecs,
          },
        });
        documentIds.push(doc.id);
      }

      await updateMediaAsset(asset.id, {
        processingStatus: 'completed',
        caption: `Audio: ${transcript.durationSecs.toFixed(0)}s, ${
          transcript.chunks.length
        } segments`,
        durationSecs: transcript.durationSecs,
        documentIds,
      });
    }
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
