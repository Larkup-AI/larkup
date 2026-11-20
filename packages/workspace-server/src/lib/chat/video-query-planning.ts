import type { VideoInvestigationDirective } from '@larkup/core/video-knowledge/query-planner';

export interface VideoQuestionSignals {
  hasPosition?: boolean;
  connectsBeyondPosition?: boolean;
  asksForSettledOutcome?: boolean;
  asksForExhaustiveCoverage?: boolean;
}

/**
 * Reconcile the planner directive with the independent question classifier.
 * The classifier is deliberately language-neutral and has final authority over
 * outcome requests, because a broad planner can otherwise mistake “who won?”
 * for source synthesis and send the answer through appearance rendering.
 */
export function reconcileVideoInvestigation(
  planned: VideoInvestigationDirective | undefined,
  signals: VideoQuestionSignals | undefined,
): VideoInvestigationDirective | undefined {
  if (signals?.asksForSettledOutcome) {
    return { scope: 'temporal', goal: 'resolve' };
  }
  if (signals?.hasPosition === false && signals.asksForExhaustiveCoverage) {
    return {
      scope: 'source',
      goal: 'enumerate',
      ...(planned?.evidence?.length ? { evidence: planned.evidence } : {}),
      recordSet: planned?.recordSet ?? 'all',
    };
  }
  if (signals?.hasPosition === false && planned?.timeRange) {
    return unboundedVideoInvestigation(planned);
  }
  if ((signals?.connectsBeyondPosition || planned?.goal === 'trace') && planned?.timeRange) {
    return {
      ...planned,
      scope: 'temporal',
      goal: 'trace',
      evidence: ['visual'],
      recordSet: 'observed',
    };
  }
  return planned;
}

/** Drop an unsupported source boundary while preserving the evidence operation. */
export function unboundedVideoInvestigation(
  planned: VideoInvestigationDirective,
): VideoInvestigationDirective {
  const unbounded = { ...planned };
  delete unbounded.timeRange;
  return unbounded;
}

export function videoSourceTimestamp(range: {
  startSecs?: unknown;
  endSecs?: unknown;
}): string | undefined {
  const start = range.startSecs;
  const end = range.endSecs;
  if (typeof start !== 'number' || !Number.isFinite(start) || start < 0) return undefined;
  const format = (seconds: number) => {
    const value = Math.floor(seconds);
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    const remainder = String(value % 60).padStart(2, '0');
    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, '0')}:${remainder}`
      : `${minutes}:${remainder}`;
  };
  return typeof end === 'number' && Number.isFinite(end) && end > start
    ? `${format(start)}–${format(end)}`
    : format(start);
}

/** Resolve references only when a previous media question actually exists. */
export function resolveVideoEvidenceQuestion(
  question: string,
  previousQuestion: string | undefined,
  proposed: unknown,
): string {
  return previousQuestion?.trim() && typeof proposed === 'string' && proposed.trim()
    ? proposed.trim()
    : question;
}
