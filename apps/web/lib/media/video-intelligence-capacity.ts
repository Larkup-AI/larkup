import type { MediaAsset } from '@larkup/core/types';

export interface VideoIntelligenceUsageSnapshot {
  sourceMinutesLimit: number | null;
  sourceMinutesUsed: number;
  activeJobs: number;
  concurrentJobsLimit: number;
  /** IDs are supplied by newer control planes so orphan recovery is exact. */
  activeJobIds?: string[];
}

interface RemoteVideoJobState {
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
}

type LocalVideoJobAsset = Pick<
  MediaAsset,
  'type' | 'processingStatus' | 'processingMessage' | 'activeVideoIntelligenceJobId'
>;

export function isLocallyActiveVideoJob(asset: LocalVideoJobAsset): boolean {
  return (
    asset.type === 'video' &&
    (asset.processingStatus === 'processing' ||
      (asset.processingStatus === 'pending' && Boolean(asset.processingMessage)))
  );
}

function hasAvailableJobSlot(usage: VideoIntelligenceUsageSnapshot): boolean {
  return usage.activeJobs < Math.max(1, usage.concurrentJobsLimit || 1);
}

/**
 * Reconciles a full cloud slot before rejecting new work. A remote job is
 * cancelled only when its exact ID belongs to a local asset that is terminal;
 * jobs from another project or browser remain untouched.
 */
export async function reconcileVideoIntelligenceCapacity(input: {
  assets: LocalVideoJobAsset[];
  getUsage: () => Promise<VideoIntelligenceUsageSnapshot>;
  getJob: (jobId: string) => Promise<RemoteVideoJobState>;
  cancelJob: (jobId: string) => Promise<unknown>;
  initialUsage?: VideoIntelligenceUsageSnapshot;
  retryDelaysMs?: number[];
  wait?: (milliseconds: number) => Promise<void>;
}): Promise<VideoIntelligenceUsageSnapshot> {
  let usage = input.initialUsage ?? (await input.getUsage());
  if (hasAvailableJobSlot(usage)) return usage;

  const assetsByRemoteJob = new Map(
    input.assets
      .filter((asset) => asset.type === 'video' && asset.activeVideoIntelligenceJobId)
      .map((asset) => [asset.activeVideoIntelligenceJobId as string, asset]),
  );
  let inspectedKnownJob = false;

  for (const jobId of new Set(usage.activeJobIds ?? [])) {
    const localAsset = assetsByRemoteJob.get(jobId);
    if (!localAsset || isLocallyActiveVideoJob(localAsset)) continue;

    try {
      inspectedKnownJob = true;
      const remoteJob = await input.getJob(jobId);
      if (remoteJob.status === 'queued' || remoteJob.status === 'running') {
        await input.cancelJob(jobId);
      }
    } catch {
      // A concurrent poll may have settled the job between usage and lookup.
      // The fresh usage reads below remain the source of truth.
    }
  }

  if (inspectedKnownJob) {
    usage = await input.getUsage();
    if (hasAvailableJobSlot(usage)) return usage;
  }

  const wait =
    input.wait ??
    ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  for (const delay of input.retryDelaysMs ?? [350, 900]) {
    if (delay > 0) await wait(delay);
    usage = await input.getUsage();
    if (hasAvailableJobSlot(usage)) return usage;
  }

  return usage;
}
