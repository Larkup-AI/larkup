import type { TimeRange } from './types';

export interface VideoKnowledgeEvaluationCase {
  id: string;
  expectedEvidenceRanges: TimeRange[];
  expectedClaimSupported: boolean;
  expectedTimestampSecs?: number;
}

export interface VideoKnowledgeEvaluationResult {
  coverage: number;
  timestampErrorSecs?: number;
  supportedClaimPrecision: number;
}

/** Deterministic release metrics for curated fixtures; no model judgement is hidden here. */
export function scoreVideoKnowledgeEvaluation(
  testCase: VideoKnowledgeEvaluationCase,
  actual: { ranges: TimeRange[]; claimSupported: boolean; timestampSecs?: number },
): VideoKnowledgeEvaluationResult {
  const expected = testCase.expectedEvidenceRanges;
  const matched = expected.filter((range) =>
    actual.ranges.some(
      (candidate) => candidate.startSecs <= range.endSecs && candidate.endSecs >= range.startSecs,
    ),
  ).length;
  return {
    coverage: expected.length === 0 ? 1 : matched / expected.length,
    timestampErrorSecs:
      testCase.expectedTimestampSecs === undefined || actual.timestampSecs === undefined
        ? undefined
        : Math.abs(testCase.expectedTimestampSecs - actual.timestampSecs),
    supportedClaimPrecision: actual.claimSupported === testCase.expectedClaimSupported ? 1 : 0,
  };
}
