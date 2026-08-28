export interface MediaProgressStep {
  stage: string;
  status: 'waiting' | 'running' | 'completed' | 'skipped' | 'failed';
  percent?: number;
  current?: number;
  total?: number;
  unit?: string;
}

/** Use the current attempt rather than the original upload time after a retry. */
export function mediaProcessingStartedAt(asset: {
  createdAt: string;
  processingStartedAt?: string;
}): string {
  return asset.processingStartedAt ?? asset.createdAt;
}

const STAGE_LABELS: Record<string, string> = {
  download: 'Download',
  extract: 'Media extraction',
  transcribe: 'Speech timeline',
  vision: 'Visual analysis',
  synthesize: 'Knowledge notes',
  index: 'Search indexing',
};

/** The last running stage is the primary visible pipeline stage. */
export function primaryRunningMediaStep<T extends MediaProgressStep>(
  steps: T[] | undefined,
): T | undefined {
  return steps?.filter((step) => step.status === 'running').at(-1);
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
  return [label, count, `${Math.round(progress)}% this step`].filter(Boolean).join(' · ');
}
