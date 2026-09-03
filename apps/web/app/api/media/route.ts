import { NextResponse } from 'next/server';
import {
  readMediaAssets,
  deleteMediaAsset,
  deleteMediaAssets,
  mediaStats,
  type NewMediaAssetInput,
} from '@larkup/core/media-store';
import { isToolInstalled } from '@larkup/marketplace/installer';
import { createStorageProvider } from '@larkup/marketplace/storage';
import { deleteDocuments } from '@larkup/core/documents-store';
import { readConfig } from '@larkup/core/config-store';
import { createAdapter } from '@larkup/vector-stores/factory';
import type { MediaType } from '@larkup/core/types';
import { runWithProject } from '@larkup/core/project-store';
import { deleteVideoKnowledgeForMediaAsset } from '@larkup/core/video-knowledge/deletion-store';
import { resolveGroupId } from '@larkup/core/groups-store';
import {
  cancelVideoIntelligenceJob,
  purgeLocalVideoIntelligenceJobData,
} from '@/lib/media/video-intelligence-adapter';
import { inspectMediaUrl } from '@/lib/media/source-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET → list media assets, optionally filtered by type. */
export async function GET(req: Request) {
  return withRequestServer(req, () => listMedia(req));
}

async function listMedia(req: Request) {
  const url = new URL(req.url);
  const requestedType = url.searchParams.get('type');
  const typeFilter: MediaType | null =
    requestedType === 'image' || requestedType === 'video' || requestedType === 'audio'
      ? requestedType
      : null;

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
    if (req.headers.get('content-type')?.includes('application/json')) {
      return await importRemoteMedia(req, config);
    }

    const formData = await req.formData();
    const files = formData.getAll('file') as File[];
    const rawDurations = formData.get('mediaDurations') as string | null;
    const mediaDurations = (() => {
      if (!rawDurations) return [] as Array<number | null>;
      try {
        const parsed = JSON.parse(rawDurations);
        return Array.isArray(parsed)
          ? parsed.map((value) => (Number.isFinite(Number(value)) ? Number(value) : null))
          : [];
      } catch {
        return [] as Array<number | null>;
      }
    })();
    const indexingInstructions = (formData.get('indexingInstructions') as string) || undefined;
    const rawGroupId = formData.get('groupId');
    const groupId = await resolveGroupId(typeof rawGroupId === 'string' ? rawGroupId : undefined);
    const rawQuality = formData.get('indexingQuality') as string | null;
    const indexingQuality = rawQuality ? Number(rawQuality) : undefined;
    const rawToolInputs = formData.get('toolInputs') as string | null;
    let toolInputs: Record<string, unknown> | undefined;
    if (rawToolInputs) {
      if (rawToolInputs.length > 20_000) {
        return NextResponse.json({ error: 'Indexing guide is too large.' }, { status: 400 });
      }
      try {
        const parsed = JSON.parse(rawToolInputs);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('expected an object');
        }
        toolInputs = parsed as Record<string, unknown>;
      } catch {
        return NextResponse.json({ error: 'Invalid marketplace tool input.' }, { status: 400 });
      }
    }

    if (files.length === 0) {
      return NextResponse.json({ error: 'No files provided.' }, { status: 400 });
    }

    if (config.embeddingProvider !== 'custom' && !config.embeddingApiKey?.trim()) {
      return NextResponse.json(
        { error: 'Configure an embedding provider API key before adding data.' },
        { status: 409 },
      );
    }

    const storage = createStorageProvider();
    const results: NewMediaAssetInput[] = [];

    for (const [fileIndex, file] of files.entries()) {
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
        durationSecs: mediaDurations[fileIndex] ?? undefined,
        indexingInstructions,
        indexingQuality,
        toolInputs,
        groupId,
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

async function importRemoteMedia(req: Request, config: Awaited<ReturnType<typeof readConfig>>) {
  const body = (await req.json()) as {
    urls?: string[];
    estimateOnly?: boolean;
    mediaType?: 'image' | 'video' | 'audio';
    groupId?: string;
    toolInputs?: Record<string, unknown>;
  };
  if (
    body.toolInputs &&
    (typeof body.toolInputs !== 'object' ||
      Array.isArray(body.toolInputs) ||
      JSON.stringify(body.toolInputs).length > 20_000)
  ) {
    return NextResponse.json({ error: 'Invalid marketplace tool input.' }, { status: 400 });
  }
  const urls = [...new Set(body.urls?.map((url) => url.trim()).filter(Boolean) ?? [])];
  const groupId = await resolveGroupId(body.groupId);
  if (urls.length === 0 || urls.length > 10) {
    return NextResponse.json({ error: 'Provide between 1 and 10 media URLs.' }, { status: 400 });
  }
  if (
    !body.estimateOnly &&
    config.embeddingProvider !== 'custom' &&
    !config.embeddingApiKey?.trim()
  ) {
    return NextResponse.json(
      { error: 'Configure an embedding provider API key before adding data.' },
      { status: 409 },
    );
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
          groupId,
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
  const toolId = body.mediaType === 'video' ? 'video-intelligence' : 'video-audio';
  const toolName = body.mediaType === 'video' ? 'Video Intelligence' : 'Audio Transcription';
  if (!(await isToolInstalled(toolId))) {
    return NextResponse.json(
      { error: `Install ${toolName} before importing media URLs.` },
      { status: 409 },
    );
  }

  // URL import is a shared application capability. The selected indexing tool
  // owns processing after the source is stored.
  if (body.estimateOnly) {
    const estimates = [];
    for (const url of urls) {
      let estimate;
      try {
        estimate = await inspectMediaUrl(url);
      } catch (error) {
        // inspectMediaUrl rejects unreachable, private, and non-media URLs.
        // Those are all bad input, not a server fault.
        return NextResponse.json(
          { error: error instanceof Error ? error.message : 'Could not inspect the media URL.' },
          { status: 400 },
        );
      }
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
      groupId,
      toolInputs: body.toolInputs,
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
      await cancelManagedVideoIndexing(asset);
      await purgeLocalVideoIntelligenceCache(asset);
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
      await cancelManagedVideoIndexing(asset);
      await purgeLocalVideoIntelligenceCache(asset);
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

async function cancelManagedVideoIndexing(asset: {
  type: MediaType;
  activeVideoIntelligenceJobId?: string;
}): Promise<void> {
  if (asset.type !== 'video' || !asset.activeVideoIntelligenceJobId) return;
  try {
    await cancelVideoIntelligenceJob(asset.activeVideoIntelligenceJobId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not stop the active video job.';
    throw new Error(`The video is still indexing, so it was not removed. ${message}`);
  }
}

async function purgeLocalVideoIntelligenceCache(asset: {
  type: MediaType;
  activeVideoIntelligenceJobId?: string;
}): Promise<void> {
  if (asset.type !== 'video' || !asset.activeVideoIntelligenceJobId) return;
  try {
    await purgeLocalVideoIntelligenceJobData(asset.activeVideoIntelligenceJobId);
  } catch (error) {
    // The host storage and evidence state are still deleted below. Do not
    // block deletion merely because an older/stopped local runtime can no
    // longer be reached; it has no active host asset to expose afterwards.
    console.warn('[media] could not purge local Video Intelligence cache:', error);
  }
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
  return serverId ? runWithProject(serverId, fn) : fn();
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

/* Media API helpers. */
/* Helpers                                                             */
/* End media API helpers. */

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
