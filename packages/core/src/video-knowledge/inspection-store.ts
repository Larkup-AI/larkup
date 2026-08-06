import { randomUUID } from 'node:crypto';
import { mutateVideoKnowledgeState, readVideoKnowledgeState } from './store';
import type { BackgroundRefinementJob, InspectionBudgetReservation } from './types';

export function reserveInspectionBudget(
  input: Omit<InspectionBudgetReservation, 'id' | 'status' | 'createdAt'>,
) {
  return mutateVideoKnowledgeState((state) => {
    const existing = state.inspectionReservations.find(
      (reservation) =>
        reservation.mediaAssetId === input.mediaAssetId &&
        reservation.queryId === input.queryId &&
        reservation.purpose === input.purpose &&
        reservation.status === 'reserved',
    );
    if (existing) return existing;
    const reservation: InspectionBudgetReservation = {
      ...input,
      id: randomUUID(),
      status: 'reserved',
      createdAt: new Date().toISOString(),
    };
    state.inspectionReservations.push(reservation);
    return reservation;
  });
}

export function settleInspectionBudget(id: string, status: 'released' | 'consumed') {
  return mutateVideoKnowledgeState((state) => {
    const reservation = state.inspectionReservations.find((candidate) => candidate.id === id);
    if (!reservation || reservation.status !== 'reserved') return undefined;
    reservation.status = status;
    reservation.releasedAt = new Date().toISOString();
    return reservation;
  });
}

export async function getReservedInspectionBudget(mediaAssetId: string, queryId: string) {
  return (await readVideoKnowledgeState()).inspectionReservations
    .filter(
      (reservation) =>
        reservation.mediaAssetId === mediaAssetId &&
        reservation.queryId === queryId &&
        reservation.status === 'reserved',
    )
    .reduce(
      (total, reservation) => ({
        durationSecs: total.durationSecs + reservation.durationSecs,
        bytes: total.bytes + reservation.bytes,
        sandboxSeconds: total.sandboxSeconds + reservation.sandboxSeconds,
        spendUsd: total.spendUsd + reservation.spendUsd,
      }),
      { durationSecs: 0, bytes: 0, sandboxSeconds: 0, spendUsd: 0 },
    );
}

export function createBackgroundRefinement(
  input: Omit<
    BackgroundRefinementJob,
    'id' | 'status' | 'createdAt' | 'updatedAt' | 'expiresAt'
  > & { expiresAt?: string },
) {
  return mutateVideoKnowledgeState((state) => {
    const now = new Date().toISOString();
    const job: BackgroundRefinementJob = {
      ...input,
      id: randomUUID(),
      status: 'awaiting_budget_approval',
      expiresAt: input.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString(),
      createdAt: now,
      updatedAt: now,
    };
    state.backgroundRefinements.push(job);
    return job;
  });
}

export function decideBackgroundRefinement(
  id: string,
  decision: 'approve' | 'decline',
  now = Date.now(),
) {
  return mutateVideoKnowledgeState((state) => {
    const job = state.backgroundRefinements.find((candidate) => candidate.id === id);
    if (!job || job.status !== 'awaiting_budget_approval') return undefined;
    const timestamp = new Date(now).toISOString();
    if (new Date(job.expiresAt).getTime() <= now) {
      job.status = 'expired';
      job.terminalReason = 'approval-expired';
      job.updatedAt = timestamp;
      return job;
    }
    job.status = decision === 'approve' ? 'queued' : 'declined';
    job.terminalReason = decision === 'approve' ? undefined : 'approval-declined';
    job.updatedAt = timestamp;
    return job;
  });
}

/** Claim an approved refinement exactly once before dispatching its bounded ranges. */
export function claimBackgroundRefinement(id: string) {
  return mutateVideoKnowledgeState((state) => {
    const job = state.backgroundRefinements.find((candidate) => candidate.id === id);
    if (!job || job.status !== 'queued') return undefined;
    job.status = 'running';
    job.updatedAt = new Date().toISOString();
    return job;
  });
}

/** Terminal execution status is durable so clients can distinguish approval from completion. */
export function finishBackgroundRefinement(
  id: string,
  status: 'completed' | 'failed',
  error?: string,
) {
  return mutateVideoKnowledgeState((state) => {
    const job = state.backgroundRefinements.find((candidate) => candidate.id === id);
    if (!job || job.status !== 'running') return undefined;
    job.status = status;
    job.error = error;
    job.terminalReason = status === 'failed' ? 'execution-failed' : undefined;
    job.updatedAt = new Date().toISOString();
    return job;
  });
}

export async function getBackgroundRefinement(id: string) {
  return (await readVideoKnowledgeState()).backgroundRefinements.find((job) => job.id === id);
}
