export interface InspectionBudget {
  remainingDurationSecs: number;
  remainingBytes: number;
  remainingSandboxSeconds: number;
  remainingSpendUsd: number;
  usedBundleRuns: number;
}

export interface InspectionEstimate {
  durationSecs: number;
  bytes: number;
  sandboxSeconds: number;
  spendUsd: number;
  lowerResolutionProbability: number;
}

export interface InspectionDecision {
  decision: 'required' | 'optional' | 'denied' | 'background-refinement';
  reason: string;
  committed: Pick<InspectionEstimate, 'durationSecs' | 'bytes' | 'sandboxSeconds' | 'spendUsd'>;
}

/**
 * Per-bundle hard cap. `durationSecs` in particular is the contract callers
 * that build a `recommendedInspection` range must respect: a single
 * dispatched inspection wider than this always falls back to
 * `background-refinement` (deferred, non-blocking) instead of `required`, so
 * a range wider than this must be split into `<= durationSecs` chunks and
 * dispatched sequentially (see `chunkTimeRange` in `inspection-chunking.ts`).
 */
export const LIMITS = {
  // An interactive cloud pass samples at a deliberately sparse cadence and
  // can cover a minute without turning a straightforward question into two
  // sequential GPU jobs. The worker can still refine smaller ranges when
  // frame precision is required.
  durationSecs: 60,
  bytes: 256 * 1024 * 1024,
  sandboxSeconds: 120,
  spendUsd: 0.5,
  bundleRuns: 12,
};

/** Versioned conservative policy. Estimates are reserved before dispatch. */
export function decideInspection(input: {
  required: boolean;
  plausibleRange: boolean;
  estimate: InspectionEstimate;
  budget: InspectionBudget;
}): InspectionDecision {
  const { estimate, budget } = input;
  const committed = {
    durationSecs: estimate.durationSecs,
    bytes: estimate.bytes,
    sandboxSeconds: estimate.sandboxSeconds,
    spendUsd: estimate.spendUsd,
  };
  const exceedsPerBundle =
    estimate.durationSecs > LIMITS.durationSecs ||
    estimate.bytes > LIMITS.bytes ||
    estimate.sandboxSeconds > LIMITS.sandboxSeconds ||
    estimate.spendUsd > LIMITS.spendUsd;
  const exceedsAggregate =
    estimate.durationSecs > budget.remainingDurationSecs ||
    estimate.bytes > budget.remainingBytes ||
    estimate.sandboxSeconds > budget.remainingSandboxSeconds ||
    estimate.spendUsd > budget.remainingSpendUsd;
  if (!input.plausibleRange)
    return { decision: 'denied', reason: 'no-plausible-observable-range', committed };
  if (budget.usedBundleRuns >= LIMITS.bundleRuns || exceedsPerBundle || exceedsAggregate) {
    return {
      decision: 'background-refinement',
      reason: 'inspection-exceeds-query-budget',
      committed,
    };
  }
  if (input.required)
    return { decision: 'required', reason: 'required-observable-claim', committed };
  if (estimate.lowerResolutionProbability < 0.6)
    return {
      decision: 'denied',
      reason: 'resolution-probability-below-policy-threshold',
      committed,
    };
  return { decision: 'optional', reason: 'bounded-optional-inspection', committed };
}
