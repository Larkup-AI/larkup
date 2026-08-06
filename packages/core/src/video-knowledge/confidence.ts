import type { Confidence } from './types';

/** Confidence must be tied to actual modality coverage, never a free-form model claim. */
export function confidenceWithCoverage(input: {
  score: number;
  source: Confidence['source'];
  calibrationStatus: Confidence['calibrationStatus'];
  coverage: number;
  uncertaintyReasons?: string[];
}): Confidence {
  const coverage = Math.max(0, Math.min(1, input.coverage));
  const score = Math.max(0, Math.min(1, input.score));
  const reasons = [...(input.uncertaintyReasons ?? [])];
  if (coverage < 1)
    reasons.push(`Only ${Math.round(coverage * 100)}% of the relevant range is covered.`);
  if (input.calibrationStatus === 'uncalibrated')
    reasons.push('Analysis is uncalibrated against the evaluation corpus.');
  return {
    score: input.calibrationStatus === 'uncalibrated' ? Math.min(score, 0.7) : score,
    source: input.source,
    calibrationStatus: input.calibrationStatus,
    coverage,
    uncertaintyReasons: [...new Set(reasons)],
  };
}
