import { NextResponse } from 'next/server';
import {
  readMediaAssets,
  deleteMediaAsset,
  deleteMediaAssets,
  mediaStats,
  recoverStaleMediaAssets,
  type NewMediaAssetInput,
} from '@larkup/core/media-store';
import { isToolInstalled } from '@larkup/marketplace/installer';
import { loadTool } from '@larkup/marketplace/loader';
import { createStorageProvider } from '@larkup/marketplace/storage';
import { deleteDocuments } from '@larkup/core/documents-store';
import { readConfig } from '@larkup/core/config-store';
import { createAdapter } from '@larkup/vector-stores/factory';
import type { MediaType } from '@larkup/core/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET → list media assets, optionally filtered by type. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const typeFilter = url.searchParams.get('type') as MediaType | null;

  await recoverStaleMediaAssets();
  const [assets, stats] = await Promise.all([readMediaAssets(), mediaStats()]);
  const filtered = typeFilter ? assets.filter((a) => a.type === typeFilter) : assets;

  // Sort newest first
  filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const storage = createStorageProvider();
  const storageStats = await storage.stats();

  return NextResponse.json({
    assets: filtered,
    stats,
    storage: {
      usedBytes: storageStats.usedBytes,
      fileCount: storageStats.fileCount,
    },
  });
}

/**
 * POST → upload media files.
 * Accepts multipart/form-data with one or more "file" fields.
 */
export async function POST(req: Request) {
  try {
    if (req.headers.get('content-type')?.includes('application/json')) {
      return await importRemoteMedia(req);
    }

    const formData = await req.formData();
    const files = formData.getAll('file') as File[];

    if (files.length === 0) {
      return NextResponse.json({ error: 'No files provided.' }, { status: 400 });
    }

    const storage = createStorageProvider();
    const results: NewMediaAssetInput[] = [];

    for (const file of files) {
      const type = detectMediaType(file.type);
      if (!type) {
        continue; // skip unsupported types silently
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const ext = file.name.split('.').pop() || 'bin';
      const key = `${type}s/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

      const storageUri = await storage.store(key, buffer, file.type);

      results.push({
        type,
        fileName: file.name,
        mimeType: file.type,
        storageUri,
        fileSize: file.size,
      });
    }

    if (results.length === 0) {
      return NextResponse.json({ error: 'No supported media files found.' }, { status: 400 });
    }

    // Batch create media asset records
    const { addMediaAssets } = await import('@larkup/core/media-store');
    const assets = await addMediaAssets(results);

    return NextResponse.json({ assets, count: assets.length }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to upload media.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function importRemoteMedia(req: Request) {
  const body = (await req.json()) as {
    urls?: string[];
    estimateOnly?: boolean;
    mediaType?: 'video' | 'audio';
  };
  const urls = [...new Set(body.urls?.map((url) => url.trim()).filter(Boolean) ?? [])];
  if (urls.length === 0 || urls.length > 10) {
    return NextResponse.json({ error: 'Provide between 1 and 10 media URLs.' }, { status: 400 });
  }
  if (!(await isToolInstalled('video-audio'))) {
    return NextResponse.json(
      { error: 'Install the Video & Audio tool before importing media URLs.' },
      { status: 409 },
    );
  }

  const tool = await loadTool<any>('video-audio');
  if (!tool?.importMediaUrl || !tool?.inspectMediaUrl) {
    return NextResponse.json(
      { error: 'The installed Video & Audio tool needs an update.' },
      { status: 409 },
    );
  }

  if (body.estimateOnly) {
    const estimates = [];
    for (const url of urls) {
      const estimate = await tool.inspectMediaUrl(url);
      if (
        body.mediaType &&
        estimate.mediaType !== 'unknown' &&
        estimate.mediaType !== body.mediaType
      ) {
        return NextResponse.json(
          { error: `The URL points to ${estimate.mediaType}, not ${body.mediaType}.` },
          { status: 400 },
        );
      }
      estimates.push(estimate);
    }
    return NextResponse.json({ estimates });
  }

  const { addMediaAssets } = await import('@larkup/core/media-store');
  const inputs: import('@larkup/core/media-store').NewMediaAssetInput[] = urls.map((url) => {
    return {
      type: body.mediaType || 'video',
      fileName: 'Importing URL...',
      mimeType: 'application/octet-stream',
      storageUri: `pending://${url}`,
      fileSize: 0,
      originalUrl: url,
    };
  });

  const assets = await addMediaAssets(inputs);
  return NextResponse.json({ assets, count: assets.length }, { status: 201 });
}

/** DELETE → remove media assets. ?id=X or ?ids=X,Y */
export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  const ids = url.searchParams.get('ids');

  const storage = createStorageProvider();

  if (id) {
    const { getMediaAsset } = await import('@larkup/core/media-store');
    const asset = await getMediaAsset(id);
    if (asset) {
      await deleteMediaDocuments(asset.documentIds);
      await storage.delete(asset.storageUri).catch(() => {});
      if (asset.thumbnailUri) await storage.delete(asset.thumbnailUri).catch(() => {});
      await deleteDocuments(asset.documentIds);
    }
    await deleteMediaAsset(id);
  } else if (ids) {
    const idList = ids.split(',');
    const assets = await readMediaAssets();
    for (const asset of assets.filter((a) => idList.includes(a.id))) {
      await deleteMediaDocuments(asset.documentIds);
      await storage.delete(asset.storageUri).catch(() => {});
      if (asset.thumbnailUri) await storage.delete(asset.thumbnailUri).catch(() => {});
      await deleteDocuments(asset.documentIds);
    }
    await deleteMediaAssets(idList);
  }

  return NextResponse.json({ ok: true });
}

async function deleteMediaDocuments(documentIds: string[]): Promise<void> {
  if (documentIds.length === 0) return;
  const adapter = await createAdapter(await readConfig());
  await adapter.deleteByDocumentIds(documentIds);
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function detectMediaType(mimeType: string): MediaType | null {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return null;
}

function mimeFromFileName(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase();
  const types: Record<string, string> = {
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    mkv: 'video/x-matroska',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    flac: 'audio/flac',
  };
  return types[ext ?? ''] ?? 'application/octet-stream';
}
