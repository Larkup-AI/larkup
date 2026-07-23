import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { MediaAsset, MediaType, MediaProcessingStatus } from './types';
import { getDataDir, requireDataDir } from './workspace';

/**
 * File-backed store for media assets, scoped to the active server.
 *
 * Similar to documents-store.ts but for binary media files (images,
 * video, audio). Metadata is stored in `media-assets.json` alongside
 * the documents.json file; the actual binary files are managed by
 * the StorageProvider from @larkup/marketplace.
 */

let writeChain: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.catch(() => {});
  return run;
}

async function assetsPath(create: boolean): Promise<string | null> {
  const dir = create ? await requireDataDir() : await getDataDir();
  if (!dir) return null;
  return path.join(dir, 'media-assets.json');
}

export async function readMediaAssets(): Promise<MediaAsset[]> {
  const file = await assetsPath(false);
  if (!file) return [];
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw) as MediaAsset[];
  } catch {
    return [];
  }
}

async function writeAll(assets: MediaAsset[]) {
  const file = await assetsPath(true);
  if (!file) return;
  await fs.writeFile(file, JSON.stringify(assets, null, 2), 'utf8');
}

/* ------------------------------------------------------------------ */
/* Create                                                              */
/* ------------------------------------------------------------------ */

export interface NewMediaAssetInput {
  type: MediaType;
  fileName: string;
  mimeType: string;
  storageUri: string;
  thumbnailUri?: string;
  originalUrl?: string;
  fileSize: number;
  dimensions?: { width: number; height: number };
  durationSecs?: number;
}

export function addMediaAsset(input: NewMediaAssetInput): Promise<MediaAsset> {
  return serialize(async () => {
    const assets = await readMediaAssets();
    const now = new Date().toISOString();
    const asset: MediaAsset = {
      id: randomUUID(),
      type: input.type,
      fileName: input.fileName,
      mimeType: input.mimeType,
      storageUri: input.storageUri,
      thumbnailUri: input.thumbnailUri,
      originalUrl: input.originalUrl,
      fileSize: input.fileSize,
      dimensions: input.dimensions,
      durationSecs: input.durationSecs,
      processingStatus: 'pending',
      documentIds: [],
      createdAt: now,
      updatedAt: now,
    };
    assets.push(asset);
    await writeAll(assets);
    return asset;
  });
}

/** Batch-add many assets (e.g. bulk upload). Returns count added. */
export function addMediaAssets(inputs: NewMediaAssetInput[]): Promise<MediaAsset[]> {
  return serialize(async () => {
    const assets = await readMediaAssets();
    const now = new Date().toISOString();
    const newAssets: MediaAsset[] = inputs.map((input) => ({
      id: randomUUID(),
      type: input.type,
      fileName: input.fileName,
      mimeType: input.mimeType,
      storageUri: input.storageUri,
      thumbnailUri: input.thumbnailUri,
      originalUrl: input.originalUrl,
      fileSize: input.fileSize,
      dimensions: input.dimensions,
      durationSecs: input.durationSecs,
      processingStatus: 'pending' as const,
      documentIds: [],
      createdAt: now,
      updatedAt: now,
    }));
    assets.push(...newAssets);
    await writeAll(assets);
    return newAssets;
  });
}

/* ------------------------------------------------------------------ */
/* Update                                                              */
/* ------------------------------------------------------------------ */

export function updateMediaAsset(
  id: string,
  patch: Partial<
    Pick<
      MediaAsset,
      | 'processingStatus'
      | 'processingError'
      | 'processingProgress'
      | 'processingMessage'
      | 'caption'
      | 'thumbnailUri'
      | 'dimensions'
      | 'durationSecs'
      | 'documentIds'
      | 'fileName'
      | 'storageUri'
      | 'fileSize'
    >
  >,
): Promise<MediaAsset | undefined> {
  return serialize(async () => {
    const assets = await readMediaAssets();
    const idx = assets.findIndex((a) => a.id === id);
    if (idx < 0) return undefined;
    const current = assets[idx];
    assets[idx] = {
      ...current,
      ...patch,
      documentIds: patch.documentIds ?? current.documentIds,
      updatedAt: new Date().toISOString(),
    };
    await writeAll(assets);
    return assets[idx];
  });
}

/** Atomically claim an asset for the in-process media worker. */
export function claimMediaAsset(id: string): Promise<MediaAsset | undefined> {
  return serialize(async () => {
    const assets = await readMediaAssets();
    const index = assets.findIndex((asset) => asset.id === id);
    if (
      index < 0 ||
      assets[index].processingStatus === 'processing' ||
      assets[index].processingMessage === 'Queued for background processing...'
    ) {
      return undefined;
    }
    assets[index] = {
      ...assets[index],
      processingStatus: 'pending',
      processingError: undefined,
      processingMessage: 'Queued for background processing...',
      processingProgress: 1,
      updatedAt: new Date().toISOString(),
    };
    await writeAll(assets);
    return assets[index];
  });
}

/** Recover jobs whose worker disappeared after a process/container restart. */
export function recoverStaleMediaAssets(maxAgeMs = 5 * 60_000): Promise<number> {
  return serialize(async () => {
    const assets = await readMediaAssets();
    const cutoff = Date.now() - maxAgeMs;
    let recovered = 0;
    for (let index = 0; index < assets.length; index++) {
      const asset = assets[index];
      const wasRunning = asset.processingStatus === 'processing';
      const wasQueued =
        asset.processingStatus === 'pending' &&
        asset.processingMessage === 'Queued for background processing...';
      if ((wasRunning || wasQueued) && new Date(asset.updatedAt).getTime() < cutoff) {
        assets[index] = {
          ...asset,
          processingStatus: 'failed',
          processingError: 'The background worker stopped. Retry to resume media processing.',
          processingMessage: undefined,
          processingProgress: undefined,
          updatedAt: new Date().toISOString(),
        };
        recovered++;
      }
    }
    if (recovered > 0) await writeAll(assets);
    return recovered;
  });
}

/* ------------------------------------------------------------------ */
/* Delete                                                              */
/* ------------------------------------------------------------------ */

export function deleteMediaAsset(id: string): Promise<void> {
  return serialize(async () => {
    const assets = await readMediaAssets();
    await writeAll(assets.filter((a) => a.id !== id));
  });
}

export function deleteMediaAssets(ids: string[]): Promise<void> {
  return serialize(async () => {
    const assets = await readMediaAssets();
    const idSet = new Set(ids);
    await writeAll(assets.filter((a) => !idSet.has(a.id)));
  });
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export async function mediaStats(): Promise<{
  total: number;
  byType: Record<MediaType, number>;
  byStatus: Record<MediaProcessingStatus, number>;
  totalBytes: number;
}> {
  const assets = await readMediaAssets();
  const byType = { image: 0, video: 0, audio: 0 };
  const byStatus = { pending: 0, processing: 0, completed: 0, failed: 0 };
  let totalBytes = 0;

  for (const a of assets) {
    byType[a.type]++;
    byStatus[a.processingStatus]++;
    totalBytes += a.fileSize;
  }

  return { total: assets.length, byType, byStatus, totalBytes };
}

export async function getMediaAsset(id: string): Promise<MediaAsset | undefined> {
  const assets = await readMediaAssets();
  return assets.find((a) => a.id === id);
}

export async function getMediaAssetsByType(type: MediaType): Promise<MediaAsset[]> {
  const assets = await readMediaAssets();
  return assets.filter((a) => a.type === type);
}
