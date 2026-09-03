import { describe, expect, it } from 'vitest';
import { calculateToolIndexingEstimate } from './tool-indexing-estimate';

describe('calculateToolIndexingEstimate', () => {
  const fast = {
    processingSecondsPerSourceMinute: 4,
    maxProcessingSecondsPerSourceMinute: 5,
    fixedOverheadSeconds: 60,
    maxFixedOverheadSeconds: 60,
    creditsPerSourceMinute: 1,
  };

  it('estimates a one-hour Fast video at five to six minutes', () => {
    expect(calculateToolIndexingEstimate(fast, 60 * 60)).toEqual({
      minimumMinutes: 5,
      maximumMinutes: 6,
      credits: 60,
    });
  });

  it('keeps time and credits proportional to the actual selected duration', () => {
    expect(calculateToolIndexingEstimate(fast, 1_459 * 60)).toEqual({
      minimumMinutes: 99,
      maximumMinutes: 123,
      credits: 1_459,
    });
  });
});
