import { describe, expect, it, vi } from 'vitest';
import {
  isLocallyActiveVideoJob,
  reconcileVideoIntelligenceCapacity,
  type VideoIntelligenceUsageSnapshot,
} from './video-intelligence-capacity';

const fullUsage = (activeJobIds?: string[]): VideoIntelligenceUsageSnapshot => ({
  sourceMinutesLimit: 600,
  sourceMinutesUsed: 10,
  activeJobs: 1,
  concurrentJobsLimit: 1,
  activeJobIds,
});

const freeUsage = (): VideoIntelligenceUsageSnapshot => ({
  ...fullUsage([]),
  activeJobs: 0,
});

describe('video intelligence capacity reconciliation', () => {
  it('does not treat an unclaimed pending URL import as an active job', () => {
    expect(
      isLocallyActiveVideoJob({
        type: 'video',
        processingStatus: 'pending',
        processingMessage: undefined,
        activeVideoIntelligenceJobId: undefined,
      }),
    ).toBe(false);
  });

  it('releases the exact remote job for a terminal local asset', async () => {
    const getUsage = vi
      .fn()
      .mockResolvedValueOnce(fullUsage(['job-orphan']))
      .mockResolvedValueOnce(freeUsage());
    const getJob = vi.fn().mockResolvedValue({ status: 'running' });
    const cancelJob = vi.fn().mockResolvedValue({ status: 'cancelled' });

    const usage = await reconcileVideoIntelligenceCapacity({
      assets: [
        {
          type: 'video',
          processingStatus: 'failed',
          processingMessage: undefined,
          activeVideoIntelligenceJobId: 'job-orphan',
        },
      ],
      getUsage,
      getJob,
      cancelJob,
      retryDelaysMs: [],
    });

    expect(usage.activeJobs).toBe(0);
    expect(getJob).toHaveBeenCalledWith('job-orphan');
    expect(cancelJob).toHaveBeenCalledWith('job-orphan');
  });

  it('never cancels a remote job that is still active locally', async () => {
    const getUsage = vi.fn().mockResolvedValue(fullUsage(['job-live']));
    const getJob = vi.fn();
    const cancelJob = vi.fn();

    const usage = await reconcileVideoIntelligenceCapacity({
      assets: [
        {
          type: 'video',
          processingStatus: 'processing',
          processingMessage: 'Indexing…',
          activeVideoIntelligenceJobId: 'job-live',
        },
      ],
      getUsage,
      getJob,
      cancelJob,
      retryDelaysMs: [0],
    });

    expect(usage.activeJobs).toBe(1);
    expect(getJob).not.toHaveBeenCalled();
    expect(cancelJob).not.toHaveBeenCalled();
  });

  it('retries reconciliation without cancelling an unknown project job', async () => {
    const getUsage = vi
      .fn()
      .mockResolvedValueOnce(fullUsage(['job-other']))
      .mockResolvedValueOnce(freeUsage());
    const cancelJob = vi.fn();

    const usage = await reconcileVideoIntelligenceCapacity({
      assets: [],
      getUsage,
      getJob: vi.fn(),
      cancelJob,
      retryDelaysMs: [0],
    });

    expect(usage.activeJobs).toBe(0);
    expect(cancelJob).not.toHaveBeenCalled();
  });
});
