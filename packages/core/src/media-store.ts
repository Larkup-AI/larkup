import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  MediaAsset,
  MediaPipelineStage,
  MediaProcessingStatus,
  MediaProcessingStep,
  MediaType,
} from './types';
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

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

export async function readMediaAssets(): Promise<MediaAsset[]> {
  const file = await assetsPath(false);
  if (!file) return [];
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error(`Invalid media asset store at ${file}: expected a JSON array.`);
    }
    return parsed as MediaAsset[];
  } catch (error) {
    if (isMissingFile(error)) return [];
    // Treat corruption and permission failures as real errors. Returning an
    // empty collection here would let the next mutation erase recoverable data.
    throw error;
  }
}

async function writeAll(assets: MediaAsset[]) {
  const file = await assetsPath(true);
  if (!file) return;
  const temporaryFile = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await fs.writeFile(temporaryFile, JSON.stringify(assets, null, 2), 'utf8');
    await fs.rename(temporaryFile, file);
  } catch (error) {
    await fs.unlink(temporaryFile).catch(() => {});
    throw error;
  }
}

export const MEDIA_PIPELINE_STAGES = [
  'download',
  'extract',
  'transcribe',
  'vision',
  'synthesize',
  'index',
] as const satisfies readonly MediaPipelineStage[];

export const MEDIA_PIPELINE_STAGE_WEIGHTS: Readonly<Record<MediaPipelineStage, number>> = {
  download: 10,
  extract: 15,
  transcribe: 25,
  vision: 30,
  synthesize: 5,
  index: 15,
};

export type MediaProcessingStepPatch = Partial<Omit<MediaProcessingStep, 'stage' | 'updatedAt'>>;

function initialProcessingSteps(now: string): MediaProcessingStep[] {
  return MEDIA_PIPELINE_STAGES.map((stage) => ({
    stage,
    status: 'waiting',
    updatedAt: now,
  }));
}

function finiteNonNegative(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) ? Math.max(0, value) : undefined;
}

function boundedPercent(value: number | undefined): number | undefined {
  const normalized = finiteNonNegative(value);
  return normalized === undefined ? undefined : Math.min(100, normalized);
}

function stepPercent(step: MediaProcessingStep): number {
  if (step.status === 'completed') return 100;
  if (step.status === 'waiting' || step.status === 'skipped') return 0;
  const explicit = boundedPercent(step.percent);
  if (explicit !== undefined) return explicit;
  if (
    step.current !== undefined &&
    step.total !== undefined &&
    Number.isFinite(step.current) &&
    Number.isFinite(step.total) &&
    step.total > 0
  ) {
    return Math.min(100, Math.max(0, (step.current / step.total) * 100));
  }
  return 0;
}

function weightedProcessingProgress(steps: MediaProcessingStep[]): number {
  const applicable = steps.filter((step) => step.status !== 'skipped');
  const totalWeight = applicable.reduce(
    (sum, step) => sum + MEDIA_PIPELINE_STAGE_WEIGHTS[step.stage],
    0,
  );
  if (totalWeight === 0) return 100;
  const completedWeight = applicable.reduce(
    (sum, step) => sum + (MEDIA_PIPELINE_STAGE_WEIGHTS[step.stage] * stepPercent(step)) / 100,
    0,
  );
  return Math.round((completedWeight / totalWeight) * 100);
}

function nextRevision(asset: MediaAsset): number {
  const current = finiteNonNegative(asset.processingRevision) ?? 0;
  return Math.floor(current) + 1;
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
      processingRevision: 0,
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
      processingRevision: 0,
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
      | 'processingSteps'
      | 'processingRevision'
      | 'processingHeartbeatAt'
      | 'caption'
      | 'thumbnailUri'
      | 'dimensions'
      | 'durationSecs'
      | 'documentIds'
      | 'pendingDocumentIds'
      | 'supersededDocumentIds'
      | 'fileName'
      | 'mimeType'
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
      pendingDocumentIds: patch.pendingDocumentIds ?? current.pendingDocumentIds,
      supersededDocumentIds: patch.supersededDocumentIds ?? current.supersededDocumentIds,
      updatedAt: new Date().toISOString(),
    };
    await writeAll(assets);
    return assets[idx];
  });
}

/**
 * Merge one stage update without clobbering progress reported by parallel
 * stages. The legacy scalar progress fields remain a projection for older
 * clients while new clients can render the complete `processingSteps` state.
 */
export function updateMediaStage(
  id: string,
  stage: MediaPipelineStage,
  patch: MediaProcessingStepPatch,
): Promise<MediaAsset | undefined> {
  return serialize(async () => {
    const assets = await readMediaAssets();
    const index = assets.findIndex((asset) => asset.id === id);
    if (index < 0) return undefined;

    const now = new Date().toISOString();
    const asset = assets[index];
    const existingByStage = new Map(
      (asset.processingSteps ?? []).map((step) => [step.stage, step] as const),
    );
    const steps = initialProcessingSteps(now).map(
      (initial) => existingByStage.get(initial.stage) ?? initial,
    );
    const stepIndex = steps.findIndex((step) => step.stage === stage);
    const previous = steps[stepIndex];

    const terminalStatuses = new Set(['completed', 'skipped', 'failed']);
    const requestedStatus = patch.status ?? previous.status;
    const status = terminalStatuses.has(previous.status)
      ? previous.status
      : previous.status === 'running' && requestedStatus === 'waiting'
      ? previous.status
      : requestedStatus;

    const previousPercent = boundedPercent(previous.percent);
    const requestedPercent = boundedPercent(patch.percent);
    let percent =
      requestedPercent === undefined
        ? previousPercent
        : Math.max(previousPercent ?? 0, requestedPercent);

    const previousCurrent = finiteNonNegative(previous.current);
    const requestedCurrent = finiteNonNegative(patch.current);
    let current =
      requestedCurrent === undefined
        ? previousCurrent
        : Math.max(previousCurrent ?? 0, requestedCurrent);
    let total =
      patch.total === undefined
        ? finiteNonNegative(previous.total)
        : finiteNonNegative(patch.total);
    if (current !== undefined && total !== undefined) {
      total = Math.max(total, current);
      if (total > 0) percent = Math.max(percent ?? 0, Math.min(100, (current / total) * 100));
    }

    if (status === 'completed') {
      percent = 100;
      if (total !== undefined) current = total;
    }

    const isTerminal = terminalStatuses.has(status);
    const nextStep: MediaProcessingStep = {
      ...previous,
      ...patch,
      stage,
      status,
      percent,
      current,
      total,
      startedAt:
        patch.startedAt ??
        previous.startedAt ??
        (status === 'running' || isTerminal ? now : undefined),
      updatedAt: now,
      finishedAt: isTerminal ? patch.finishedAt ?? previous.finishedAt ?? now : undefined,
    };
    steps[stepIndex] = nextStep;

    const projectedProgress = Math.max(
      boundedPercent(asset.processingProgress) ?? 0,
      weightedProcessingProgress(steps),
    );
    const runningMessage = [...steps]
      .reverse()
      .find((step) => step.status === 'running' && step.message)?.message;
    const projectedMessage =
      nextStep.status === 'running'
        ? nextStep.message ?? patch.message ?? asset.processingMessage
        : runningMessage ?? patch.message ?? nextStep.message ?? asset.processingMessage;

    assets[index] = {
      ...asset,
      processingSteps: steps,
      processingProgress: projectedProgress,
      processingMessage: projectedMessage,
      processingRevision: nextRevision(asset),
      processingHeartbeatAt: now,
      updatedAt: now,
    };
    await writeAll(assets);
    return assets[index];
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
    const now = new Date().toISOString();
    assets[index] = {
      ...assets[index],
      processingStatus: 'pending',
      processingError: undefined,
      processingMessage: 'Queued for background processing...',
      processingProgress: 1,
      processingSteps: initialProcessingSteps(now),
      processingRevision: nextRevision(assets[index]),
      processingHeartbeatAt: now,
      updatedAt: now,
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
    const recoveryMessage = 'The background worker stopped. Retry to resume media processing.';
    let recovered = 0;
    for (let index = 0; index < assets.length; index++) {
      const asset = assets[index];
      const wasRunning = asset.processingStatus === 'processing';
      const wasQueued =
        asset.processingStatus === 'pending' &&
        asset.processingMessage === 'Queued for background processing...';
      const lastHeartbeat = asset.processingHeartbeatAt ?? asset.updatedAt;
      if ((wasRunning || wasQueued) && new Date(lastHeartbeat).getTime() < cutoff) {
        const now = new Date().toISOString();
        const recoveredSteps = asset.processingSteps?.map((step) =>
          step.status === 'running'
            ? {
                ...step,
                status: 'failed' as const,
                message: recoveryMessage,
                updatedAt: now,
                finishedAt: now,
              }
            : step,
        );
        assets[index] = {
          ...asset,
          processingStatus: 'failed',
          processingError: recoveryMessage,
          processingMessage: undefined,
          processingProgress: undefined,
          processingSteps: recoveredSteps,
          processingRevision: nextRevision(asset),
          processingHeartbeatAt: now,
          updatedAt: now,
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
