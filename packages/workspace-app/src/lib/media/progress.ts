export interface MediaProgressStep {
  stage: string;
  status: 'waiting' | 'running' | 'completed' | 'skipped' | 'failed';
  percent?: number;
  current?: number;
  total?: number;
  unit?: string;
  estimatedRemainingSeconds?: number;
  elapsedSeconds?: number;
  sequence?: number;
  message?: string;
  startedAt?: string;
  updatedAt?: string;
  finishedAt?: string;
}

/** Use the current attempt rather than the original upload time after a retry. */
export function mediaProcessingStartedAt(asset: {
  createdAt: string;
  processingStartedAt?: string;
}): string {
  return asset.processingStartedAt ?? asset.createdAt;
}

/** Returns the completed attempt duration when both persisted timestamps exist. */
export function completedMediaProcessingSeconds(asset: {
  processingStatus: string;
  processingStartedAt?: string;
  processingSteps?: MediaProgressStep[];
}): number | null {
  if (asset.processingStatus !== 'completed' || !asset.processingStartedAt) return null;

  const startedAt = Date.parse(asset.processingStartedAt);
  if (!Number.isFinite(startedAt)) return null;

  const completedSteps =
    asset.processingSteps
      ?.map((step) => Date.parse(step.finishedAt ?? ''))
      .filter(Number.isFinite) ?? [];
  if (completedSteps.length === 0) return null;
  const finishedAt = Math.max(...completedSteps);
  if (!Number.isFinite(finishedAt) || finishedAt < startedAt) return null;
  return Math.round((finishedAt - startedAt) / 1_000);
}

const STAGE_LABELS: Record<string, string> = {
  download: 'Download',
  prepare: 'Cloud video preparation',
  extract: 'Media extraction',
  transcribe: 'Speech timeline',
  vision: 'Visual analysis',
  synthesize: 'Knowledge notes',
  index: 'Search indexing',
};

/** The most recently updated running stage is the primary visible work. */
export function primaryRunningMediaStep<T extends MediaProgressStep>(
  steps: T[] | undefined,
): T | undefined {
  return steps
    ?.filter((step) => step.status === 'running')
    .reduce<T | undefined>((latest, step) => {
      if (!latest) return step;
      const latestAt = Date.parse(latest.updatedAt ?? latest.startedAt ?? '');
      const stepAt = Date.parse(step.updatedAt ?? step.startedAt ?? '');
      if (!Number.isFinite(latestAt)) return step;
      return Number.isFinite(stepAt) && stepAt >= latestAt ? step : latest;
    }, undefined);
}

export function mediaStepProgress(step: MediaProgressStep | undefined): number | null {
  if (!step) return null;
  if (typeof step.percent === 'number' && Number.isFinite(step.percent)) {
    return Math.max(0, Math.min(100, step.percent));
  }
  if (typeof step.current === 'number' && typeof step.total === 'number' && step.total > 0) {
    return Math.max(0, Math.min(100, (step.current / step.total) * 100));
  }
  return null;
}

/** Keep sub-percent worker movement visible without noisy trailing zeroes. */
export function formatMediaProgressPercent(value: number): string {
  const bounded = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const rounded = Math.round(bounded * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** Return the latest bounded worker measurement for this indexing attempt. */
export function smoothMediaProcessingProgress(
  asset: {
    processingProgress?: number;
    processingStatus: string;
    processingPaused?: boolean;
    durationSecs?: number;
    processingSteps?: MediaProgressStep[];
  },
  _now = Date.now(),
): number {
  const reported = Math.max(0, Math.min(100, asset.processingProgress ?? 0));
  if (asset.processingStatus === 'completed') return 100;
  return reported;
}

/**
 * Ease confirmed jumps and keep a slow asymptotic trickle while fresh worker
 * heartbeats prove the job is active. It can approach, but never claim, 99%.
 */
export function advanceMediaProcessingProgress(
  displayed: number,
  confirmed: number,
  elapsedMs: number,
  workerActive = false,
): number {
  const current = Math.max(0, Math.min(100, displayed));
  const target = Math.max(0, Math.min(100, confirmed));
  const boundedElapsed = Math.max(0, elapsedMs);
  if (target > current) {
    const maximumAdvance = boundedElapsed * 0.002;
    return Math.round(Math.min(target, current + maximumAdvance) * 1_000) / 1_000;
  }
  if (!workerActive || current >= 99) return current;
  const trickle = (99 - current) * (1 - Math.exp(-boundedElapsed / 1_000_000));
  return Math.round(Math.min(99, current + trickle) * 1_000) / 1_000;
}

/** A running step without fresh worker telemetry is waiting, not progressing. */
export function isMediaStepTelemetryStale(
  step: MediaProgressStep | undefined,
  now = Date.now(),
  maxAgeMs = 20_000,
): boolean {
  if (!step || step.status !== 'running') return false;
  const timestamp = Date.parse(step.updatedAt ?? step.startedAt ?? '');
  return Number.isFinite(timestamp) && now - timestamp > maxAgeMs;
}

/**
 * Reserve “Finalizing” for the last local publishing step. Visual analysis can
 * legitimately spend time at 99% while building its search vectors, so calling
 * that finalization would promise an imminent completion that is not true.
 */
export function isFinalizingMediaStep(step: MediaProgressStep | undefined): boolean {
  const progress = mediaStepProgress(step);
  return (
    step?.status === 'running' && step.stage === 'index' && progress !== null && progress >= 98
  );
}

/** A factual label for the active unit of work, separate from weighted overall progress. */
export function describeActiveMediaStep(step: MediaProgressStep | undefined): string | null {
  if (!step) return null;
  const label = STAGE_LABELS[step.stage] ?? step.stage;
  const progress = mediaStepProgress(step);
  const count =
    typeof step.current === 'number' && typeof step.total === 'number' && step.total > 0
      ? `${step.current} / ${step.total}${step.unit ? ` ${step.unit}` : ''}`
      : null;
  if (progress === null) return `${label} · active request in progress`;
  if (isFinalizingMediaStep(step)) {
    return `${label} · finalizing verified results`;
  }
  return [label, count, `${Math.round(progress)}% this step`].filter(Boolean).join(' · ');
}

/**
 * Estimate only countable work. A percentage-only ETA becomes misleading when
 * a remote worker has reported an optimistic progress band but is still
 * waiting on a model request.
 */
export function estimateMediaStepRemainingSeconds(
  step: MediaProgressStep | undefined,
  now = Date.now(),
): number | null {
  if (
    Number.isFinite(step?.estimatedRemainingSeconds) &&
    (step?.estimatedRemainingSeconds ?? 0) > 5
  ) {
    const updatedAt = Date.parse(step?.updatedAt ?? '');
    if (!Number.isFinite(updatedAt) || isMediaStepTelemetryStale(step, now)) return null;
    const sinceUpdate = Math.max(0, (now - updatedAt) / 1_000);
    const remaining = Math.round((step?.estimatedRemainingSeconds ?? 0) - sinceUpdate);
    // Never park at one second after a forecast has expired. Wait for the next
    // measured worker update and display no ETA in the meantime.
    return remaining > 0 ? remaining : null;
  }
  if (
    !step?.startedAt ||
    !Number.isFinite(step.current) ||
    !Number.isFinite(step.total) ||
    step.current === undefined ||
    step.total === undefined ||
    step.current < 2 ||
    step.total <= step.current
  ) {
    return null;
  }

  const startedAt = new Date(step.startedAt).getTime();
  if (!Number.isFinite(startedAt)) return null;
  const elapsedSeconds = Math.max(0, (now - startedAt) / 1_000);
  if (elapsedSeconds < 5) return null;

  const remainingSeconds = Math.round(
    (elapsedSeconds / step.current) * (step.total - step.current),
  );
  // A clearly unreasonable estimate is less useful than no estimate.
  return remainingSeconds > 0 && remainingSeconds <= 12 * 60 * 60 ? remainingSeconds : null;
}
