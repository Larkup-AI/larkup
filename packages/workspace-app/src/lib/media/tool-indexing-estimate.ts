export interface ToolIndexingEstimateVariant {
  processingSecondsPerSourceMinute: number;
  maxProcessingSecondsPerSourceMinute?: number;
  fixedOverheadSeconds?: number;
  maxFixedOverheadSeconds?: number;
  creditsPerSourceMinute: number;
}

export function calculateToolIndexingEstimate(
  estimate: ToolIndexingEstimateVariant | undefined,
  sourceDurationSecs?: number,
) {
  if (!estimate) return null;
  const sourceMinutes = Math.max(0, (sourceDurationSecs ?? 0) / 60);
  const displayDuration = sourceMinutes > 0 ? Math.max(sourceMinutes, 0.1) : 1;
  const minimumMinutes = Math.max(
    1,
    Math.ceil(
      ((estimate.fixedOverheadSeconds ?? 0) +
        estimate.processingSecondsPerSourceMinute * displayDuration) /
        60,
    ),
  );
  const maximumMinutes = Math.max(
    minimumMinutes,
    Math.ceil(
      ((estimate.maxFixedOverheadSeconds ?? estimate.fixedOverheadSeconds ?? 0) +
        (estimate.maxProcessingSecondsPerSourceMinute ??
          estimate.processingSecondsPerSourceMinute) *
          displayDuration) /
        60,
    ),
  );
  return {
    minimumMinutes,
    maximumMinutes,
    credits: Math.max(1, Math.ceil(estimate.creditsPerSourceMinute * displayDuration)),
  };
}
