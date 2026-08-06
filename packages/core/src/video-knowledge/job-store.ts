import { randomUUID } from 'node:crypto';
import { mutateVideoKnowledgeState, readVideoKnowledgeState } from './store';
import type {
  VideoKnowledgeJob,
  VideoKnowledgeStatus,
  VideoKnowledgeCheckpoint,
  VideoBudget,
} from './types';

export interface CreateVideoKnowledgeJobInput {
  mediaAssetId: string;
  knowledgeRevisionId: string;
  idempotencyKey: string;
  budget: VideoBudget;
}

export function createVideoKnowledgeJob(input: CreateVideoKnowledgeJobInput) {
  return mutateVideoKnowledgeState((state) => {
    const existing = state.jobs.find(
      (job) =>
        job.idempotencyKey === input.idempotencyKey &&
        !['failed', 'cancelled', 'completed'].includes(job.status),
    );
    if (existing) return existing;
    const now = new Date().toISOString();
    const job: VideoKnowledgeJob = {
      id: randomUUID(),
      mediaAssetId: input.mediaAssetId,
      knowledgeRevisionId: input.knowledgeRevisionId,
      idempotencyKey: input.idempotencyKey,
      budget: input.budget,
      status: 'queued',
      attempt: 0,
      checkpoint: {
        stage: 'queued',
        completedEvidenceIds: [],
        completedProjectionIds: [],
        updatedAt: now,
      },
      retryHistory: [],
      createdAt: now,
      updatedAt: now,
    };
    state.jobs.push(job);
    return job;
  });
}

export async function getVideoKnowledgeJob(id: string) {
  return (await readVideoKnowledgeState()).jobs.find((job) => job.id === id);
}

export async function getVideoKnowledgeJobForAsset(mediaAssetId: string) {
  return (await readVideoKnowledgeState()).jobs
    .filter((job) => job.mediaAssetId === mediaAssetId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

export function claimVideoKnowledgeJob(id: string, owner: string, leaseMs = 60_000) {
  return mutateVideoKnowledgeState((state) => {
    const job = state.jobs.find((candidate) => candidate.id === id);
    if (
      !job ||
      job.cancellationRequestedAt ||
      ['completed', 'failed', 'cancelled'].includes(job.status)
    )
      return undefined;
    const now = Date.now();
    if (job.retryAfter && new Date(job.retryAfter).getTime() > now) return undefined;
    if (
      job.leaseExpiresAt &&
      new Date(job.leaseExpiresAt).getTime() > now &&
      job.leaseOwner !== owner
    )
      return undefined;
    job.leaseOwner = owner;
    job.leaseExpiresAt = new Date(now + leaseMs).toISOString();
    job.heartbeatAt = new Date(now).toISOString();
    job.status = job.status === 'queued' ? 'acquiring' : job.status;
    job.attempt += 1;
    job.retryAfter = undefined;
    job.updatedAt = new Date(now).toISOString();
    return job;
  });
}

/** Refresh a lease without changing its checkpoint or stage. */
export function heartbeatVideoKnowledgeJob(id: string, owner: string, leaseMs = 60_000) {
  return mutateVideoKnowledgeState((state) => {
    const job = state.jobs.find((candidate) => candidate.id === id);
    if (!job || job.leaseOwner !== owner || job.cancellationRequestedAt) return undefined;
    const now = new Date().toISOString();
    job.heartbeatAt = now;
    job.leaseExpiresAt = new Date(Date.now() + leaseMs).toISOString();
    job.updatedAt = now;
    return job;
  });
}

/** Requeue only transient failures, with bounded exponential backoff and jitter. */
export function retryVideoKnowledgeJob(id: string, owner: string, reason: string, maxAttempts = 3) {
  return mutateVideoKnowledgeState((state) => {
    const job = state.jobs.find((candidate) => candidate.id === id);
    if (
      !job ||
      job.leaseOwner !== owner ||
      job.cancellationRequestedAt ||
      job.attempt >= maxAttempts
    )
      return undefined;
    const delayMs =
      Math.min(60_000, 1_000 * 2 ** Math.max(0, job.attempt - 1)) + Math.floor(Math.random() * 500);
    const now = new Date().toISOString();
    job.retryHistory.push({ attempt: job.attempt, reason, at: now });
    job.status = 'queued';
    job.retryAfter = new Date(Date.now() + delayMs).toISOString();
    job.leaseOwner = undefined;
    job.leaseExpiresAt = undefined;
    job.heartbeatAt = undefined;
    job.updatedAt = now;
    return job;
  });
}

export function checkpointVideoKnowledgeJob(
  id: string,
  owner: string,
  stage: VideoKnowledgeStatus,
  checkpoint: Partial<VideoKnowledgeCheckpoint>,
  leaseMs = 60_000,
) {
  return mutateVideoKnowledgeState((state) => {
    const job = state.jobs.find((candidate) => candidate.id === id);
    if (!job || job.leaseOwner !== owner || job.cancellationRequestedAt) return undefined;
    const now = new Date().toISOString();
    job.status = stage;
    job.checkpoint = { ...job.checkpoint, ...checkpoint, stage, updatedAt: now };
    job.heartbeatAt = now;
    job.leaseExpiresAt = new Date(Date.now() + leaseMs).toISOString();
    job.updatedAt = now;
    return job;
  });
}

export function requestVideoKnowledgeJobCancellation(id: string) {
  return mutateVideoKnowledgeState((state) => {
    const job = state.jobs.find((candidate) => candidate.id === id);
    if (!job || ['completed', 'failed', 'cancelled'].includes(job.status)) return undefined;
    job.cancellationRequestedAt = new Date().toISOString();
    job.updatedAt = job.cancellationRequestedAt;
    return job;
  });
}

export function finishVideoKnowledgeJob(
  id: string,
  owner: string,
  status: 'completed' | 'partially_failed' | 'failed' | 'cancelled',
  error?: string,
) {
  return mutateVideoKnowledgeState((state) => {
    const job = state.jobs.find((candidate) => candidate.id === id);
    if (!job || (job.leaseOwner && job.leaseOwner !== owner)) return undefined;
    job.status = status;
    job.error = error;
    job.leaseOwner = undefined;
    job.leaseExpiresAt = undefined;
    job.updatedAt = new Date().toISOString();
    return job;
  });
}

/** Requeue expired leases after a worker/container restart without losing checkpoints. */
export function recoverStaleVideoKnowledgeJobs(nowMs = Date.now()) {
  return mutateVideoKnowledgeState((state) => {
    let recovered = 0;
    for (const job of state.jobs) {
      if (!job.leaseExpiresAt || ['completed', 'failed', 'cancelled'].includes(job.status))
        continue;
      if (new Date(job.leaseExpiresAt).getTime() > nowMs) continue;
      job.leaseOwner = undefined;
      job.leaseExpiresAt = undefined;
      job.heartbeatAt = undefined;
      job.status = 'queued';
      job.retryHistory.push({
        attempt: job.attempt,
        reason: 'worker-lease-expired',
        at: new Date(nowMs).toISOString(),
      });
      job.updatedAt = new Date(nowMs).toISOString();
      recovered++;
    }
    return recovered;
  });
}
