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
import { runWithServer } from '@larkup/core/workspace';
import { deleteVideoKnowledgeForMediaAsset } from '@larkup/core/video-knowledge/deletion-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET → list media assets, optionally filtered by type. */
export async function GET(req: Request) {
  return withRequestServer(req, () => listMedia(req));
}

async function listMedia(req: Request) {
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
  return withRequestServer(req, () => saveMedia(req));
}

async function saveMedia(req: Request) {
  try {
    const config = await readConfig();
    if (config.embeddingProvider !== 'custom' && !config.embeddingApiKey?.trim()) {
      return NextResponse.json(
        { error: 'Configure an embedding provider API key before adding data.' },
        { status: 409 },
      );
    }
    if (req.headers.get('content-type')?.includes('application/json')) {
      return await importRemoteMedia(req);
    }

    const formData = await req.formData();
    const files = formData.getAll('file') as File[];
    const indexingInstructions = (formData.get('indexingInstructions') as string) || undefined;
    const rawQuality = formData.get('indexingQuality') as string | null;
    const indexingQuality = rawQuality ? Number(rawQuality) : undefined;

    if (files.length === 0) {
      return NextResponse.json({ error: 'No files provided.' }, { status: 400 });
    }

    const storage = createStorageProvider();
    const results: NewMediaAssetInput[] = [];

    for (const file of files) {
      const type = detectMediaType(file.type);
      if (!type) {
        continue;
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
        indexingInstructions,
        indexingQuality,
      });
    }

    if (results.length === 0) {
      return NextResponse.json({ error: 'No supported media files found.' }, { status: 400 });
    }

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
    mediaType?: 'image' | 'video' | 'audio';
  };
  const urls = [...new Set(body.urls?.map((url) => url.trim()).filter(Boolean) ?? [])];
  if (urls.length === 0 || urls.length > 10) {
    return NextResponse.json({ error: 'Provide between 1 and 10 media URLs.' }, { status: 400 });
  }
  if (body.mediaType === 'image') {
    try {
      const storage = createStorageProvider();
      const { addMediaAssets } = await import('@larkup/core/media-store');
      const inputs: NewMediaAssetInput[] = [];
      for (const url of urls) {
        const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        if (!response.ok) throw new Error(`Could not download ${url}`);
        const mimeType =
          response.headers.get('content-type')?.split(';')[0] || mimeFromFileName(url);
        if (!mimeType.startsWith('image/')) throw new Error('The URL does not point to an image.');
        const buffer = Buffer.from(await response.arrayBuffer());
        const ext = url.split('?')[0].split('.').pop() || 'img';
        const storageUri = await storage.store(
          `images/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`,
          buffer,
          mimeType,
        );
        inputs.push({
          type: 'image',
          fileName: url.split('/').pop()?.split('?')[0] || 'image',
          mimeType,
          storageUri,
          fileSize: buffer.length,
          originalUrl: url,
        });
      }
      const assets = await addMediaAssets(inputs);
      return NextResponse.json({ assets, count: assets.length }, { status: 201 });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Could not import image URLs.' },
        { status: 400 },
      );
    }
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
  return withRequestServer(req, () => removeMedia(req));
}

async function removeMedia(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  const ids = url.searchParams.get('ids');
  const force = url.searchParams.get('force') === 'true';

  const storage = createStorageProvider();

  if (id) {
    const { getMediaAsset } = await import('@larkup/core/media-store');
    const asset = await getMediaAsset(id);
    if (asset) {
      if (!force && isMediaProcessing(asset)) {
        return NextResponse.json(
          { error: 'Wait for the media indexing job to finish before deleting it.' },
          { status: 409 },
        );
      }
      const documentIds = allMediaDocumentIds(asset);
      await deleteMediaDocuments(documentIds);
      await storage.delete(asset.storageUri).catch(() => {});
      if (asset.thumbnailUri) await storage.delete(asset.thumbnailUri).catch(() => {});
      await deleteDocuments(documentIds);
      await deleteVideoKnowledgeForMediaAsset(asset.id);
    }
    await deleteMediaAsset(id);
  } else if (ids) {
    const idList = ids.split(',');
    const assets = await readMediaAssets();
    const selectedAssets = assets.filter((asset) => idList.includes(asset.id));
    if (!force && selectedAssets.some(isMediaProcessing)) {
      return NextResponse.json(
        { error: 'Wait for all selected media indexing jobs to finish before deleting them.' },
        { status: 409 },
      );
    }
    for (const asset of selectedAssets) {
      const documentIds = allMediaDocumentIds(asset);
      await deleteMediaDocuments(documentIds);
      await storage.delete(asset.storageUri).catch(() => {});
      if (asset.thumbnailUri) await storage.delete(asset.thumbnailUri).catch(() => {});
      await deleteDocuments(documentIds);
      await deleteVideoKnowledgeForMediaAsset(asset.id);
    }
    await deleteMediaAssets(idList);
  }

  return NextResponse.json({ ok: true });
}

function isMediaProcessing(asset: {
  processingStatus: string;
  processingMessage?: string;
}): boolean {
  return (
    asset.processingStatus === 'processing' ||
    (asset.processingStatus === 'pending' &&
      asset.processingMessage === 'Queued for background processing...')
  );
}

function withRequestServer<T>(req: Request, fn: () => T): T {
  const serverId = new URL(req.url).searchParams.get('serverId');
  return serverId ? runWithServer(serverId, fn) : fn();
}

async function deleteMediaDocuments(documentIds: string[]): Promise<void> {
  if (documentIds.length === 0) return;
  const adapter = await createAdapter(await readConfig());
  await adapter.deleteByDocumentIds(documentIds);
}

function allMediaDocumentIds(asset: {
  documentIds: string[];
  pendingDocumentIds?: string[];
  supersededDocumentIds?: string[];
}): string[] {
  return [
    ...new Set([
      ...asset.documentIds,
      ...(asset.pendingDocumentIds ?? []),
      ...(asset.supersededDocumentIds ?? []),
    ]),
  ];
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
