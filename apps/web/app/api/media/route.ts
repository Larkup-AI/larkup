import { NextResponse } from 'next/server';
import {
  readMediaAssets,
  addMediaAsset,
  deleteMediaAsset,
  deleteMediaAssets,
  mediaStats,
  type NewMediaAssetInput,
} from '@larkup/core/media-store';
import { createStorageProvider } from '@larkup/marketplace/storage';
import type { MediaType } from '@larkup/core/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET → list media assets, optionally filtered by type. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const typeFilter = url.searchParams.get('type') as MediaType | null;

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
      await storage.delete(asset.storageUri).catch(() => {});
      if (asset.thumbnailUri) await storage.delete(asset.thumbnailUri).catch(() => {});
    }
    await deleteMediaAsset(id);
  } else if (ids) {
    const idList = ids.split(',');
    const assets = await readMediaAssets();
    for (const asset of assets.filter((a) => idList.includes(a.id))) {
      await storage.delete(asset.storageUri).catch(() => {});
      if (asset.thumbnailUri) await storage.delete(asset.thumbnailUri).catch(() => {});
    }
    await deleteMediaAssets(idList);
  }

  return NextResponse.json({ ok: true });
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
