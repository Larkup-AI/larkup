import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getMediaAsset } from '@larkup/core/media-store';
import { createStorageProvider } from '@larkup/marketplace/storage';
import { loadTool } from '@larkup/marketplace/loader';
import { isToolInstalled } from '@larkup/marketplace/installer';
import { runWithProject } from '@larkup/core/project-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/media/[id]/frame?t=<seconds>&serverId=<id>
 *
 * Extract and serve a single video frame at the requested timestamp.
 * Used by the chat agent's `presentMedia` tool to show "what was on
 * screen at X:XX" — a precise visual answer to temporal questions.
 *
 * The frame is extracted on-the-fly via the Video & Audio tool's
 * `extractFrameAtTimestamp` function and served as a private JPEG. It is a
 * requested seek position, not a claim that the decoder returned a source
 * frame with that exact presentation timestamp.
 */
export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const serverId = new URL(req.url).searchParams.get('serverId');
  const handler = () => extractAndServeFrame(req, context);
  return serverId ? runWithProject(serverId, handler) : handler();
}

async function extractAndServeFrame(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const timestampParam = url.searchParams.get('t');

  if (timestampParam === null) {
    return NextResponse.json(
      { error: 'Query parameter "t" (timestamp in seconds) is required.' },
      { status: 400 },
    );
  }

  const timestampSecs = Number(timestampParam);
  if (!Number.isFinite(timestampSecs) || timestampSecs < 0) {
    return NextResponse.json(
      { error: 'Timestamp must be a non-negative number of seconds.' },
      { status: 400 },
    );
  }

  const asset = await getMediaAsset(id);
  if (!asset) {
    return NextResponse.json({ error: 'Media asset not found.' }, { status: 404 });
  }

  if (asset.type !== 'video') {
    return NextResponse.json(
      { error: 'Frame extraction is only supported for video assets.' },
      { status: 400 },
    );
  }

  if (asset.processingStatus !== 'completed') {
    return NextResponse.json(
      { error: 'Video must be fully indexed before frame extraction.' },
      { status: 409 },
    );
  }

  const installed = await isToolInstalled('video-audio');
  if (!installed) {
    return NextResponse.json({ error: 'Video & Audio tool is not installed.' }, { status: 503 });
  }

  const tool = await loadTool<any>('video-audio');
  if (!tool?.extractFrameAtTimestamp) {
    return NextResponse.json(
      { error: 'Video & Audio tool does not support frame extraction. Update the tool.' },
      { status: 503 },
    );
  }

  const storage = createStorageProvider();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'larkup-frame-'));

  try {
    // Resolve or download the video file.
    const localFile = await storage.resolvePath?.(asset.storageUri);
    const ext = asset.fileName.split('.').pop() || 'mp4';
    const videoPath = localFile || path.join(tmpDir, `source.${ext}`);
    if (!localFile) {
      await fs.writeFile(videoPath, await storage.retrieve(asset.storageUri));
    }

    // Clamp timestamp to video duration.
    const effectiveTimestamp = asset.durationSecs
      ? Math.min(timestampSecs, asset.durationSecs)
      : timestampSecs;

    const frame = await tool.extractFrameAtTimestamp(videoPath, effectiveTimestamp, {
      outputDir: path.join(tmpDir, 'output'),
      maxWidth: 1280,
    });

    const frameData = await fs.readFile(frame.path);

    return new NextResponse(new Uint8Array(frameData), {
      headers: {
        'Content-Type': 'image/jpeg',
        'Content-Length': String(frameData.length),
        'Cache-Control': 'private, no-store',
        'X-Frame-Timestamp': String(effectiveTimestamp),
        'X-Frame-Timestamp-Precision': frame.timestampPrecision,
        'X-Frame-Width': String(frame.width),
        'X-Frame-Height': String(frame.height),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Frame extraction failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
