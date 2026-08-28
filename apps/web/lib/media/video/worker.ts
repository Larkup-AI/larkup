import { randomUUID } from 'node:crypto';
import {
  checkpointVideoKnowledgeJob,
  claimVideoKnowledgeJob,
  finishVideoKnowledgeJob,
  getVideoKnowledgeJob,
  heartbeatVideoKnowledgeJob,
  retryVideoKnowledgeJob,
} from '@larkup/core/video-knowledge/job-store';
import type { VideoKnowledgeStatus } from '@larkup/core/video-knowledge/types';

export interface VideoKnowledgeWorkerContext {
  jobId: string;
  owner: string;
  signal: AbortSignal;
  checkpoint: (
    stage: VideoKnowledgeStatus,
    patch?: {
      chunkIndex?: number;
      completedEvidenceIds?: string[];
      completedProjectionIds?: string[];
    },
  ) => Promise<void>;
}

export interface LeasedVideoKnowledgeJob extends VideoKnowledgeWorkerContext {
  /** Stops the worker heartbeat after the pipeline has reached a terminal state. */
  release: () => void;
}

/**
 * Acquire the durable lease used by the web/CLI pipeline. Keeping the lease
 * lifecycle here prevents route handlers from silently bypassing stale-job
 * recovery, heartbeat, and cancellation propagation.
 */
export async function startLeasedVideoKnowledgeJob(
  jobId: string,
  options: { leaseMs?: number } = {},
): Promise<LeasedVideoKnowledgeJob | undefined> {
  const owner = randomUUID();
  const leaseMs = options.leaseMs ?? 60_000;
  const job = await claimVideoKnowledgeJob(jobId, owner, leaseMs);
  if (!job) return undefined;
  const controller = new AbortController();
  const heartbeat = setInterval(() => {
    void (async () => {
      const current = await getVideoKnowledgeJob(jobId);
      if (!current || current.cancellationRequestedAt) controller.abort();
      else if (!(await heartbeatVideoKnowledgeJob(jobId, owner, leaseMs))) controller.abort();
    })();
  }, Math.max(1_000, Math.floor(leaseMs / 3)));
  const release = () => clearInterval(heartbeat);
  return {
    jobId,
    owner,
    signal: controller.signal,
    release,
    checkpoint: async (stage, patch = {}) => {
      if (
        controller.signal.aborted ||
        !(await checkpointVideoKnowledgeJob(jobId, owner, stage, patch, leaseMs))
      ) {
        controller.abort();
        throw new Error('Video knowledge job was cancelled or its lease was lost.');
      }
    },
  };
}

/**
 * Lease wrapper for durable workers. Pipeline implementations receive a
 * cancellation signal and must checkpoint after each chunk/batch; this module
 * owns only job lifecycle, never FFmpeg or provider credentials.
 */
export async function runLeasedVideoKnowledgeJob(
  jobId: string,
  run: (context: VideoKnowledgeWorkerContext) => Promise<'completed' | 'partially_failed'>,
  options: { leaseMs?: number; maxAttempts?: number } = {},
) {
  const context = await startLeasedVideoKnowledgeJob(jobId, options);
  if (!context) return { claimed: false as const };
  try {
    const status = await run(context);
    if (context.signal.aborted) {
      await finishVideoKnowledgeJob(jobId, context.owner, 'cancelled', 'Cancellation requested.');
      return { claimed: true as const, status: 'cancelled' as const };
    }
    await finishVideoKnowledgeJob(jobId, context.owner, status);
    return { claimed: true as const, status };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Video knowledge worker failed.';
    if (context.signal.aborted || /cancelled|lease was lost/i.test(message)) {
      await finishVideoKnowledgeJob(jobId, context.owner, 'cancelled', message);
      return { claimed: true as const, status: 'cancelled' as const };
    }
    const retry = await retryVideoKnowledgeJob(jobId, context.owner, message, options.maxAttempts);
    if (!retry) await finishVideoKnowledgeJob(jobId, context.owner, 'failed', message);
    return {
      claimed: true as const,
      status: retry ? ('queued' as const) : ('failed' as const),
      error: message,
    };
  } finally {
    context.release();
  }
}
