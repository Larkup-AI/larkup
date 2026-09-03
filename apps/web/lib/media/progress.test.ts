import { describe, expect, it } from 'vitest';
import { MEDIA_PIPELINE_STAGES, weightedProcessingProgress } from '@larkup/core/media-store';
import type { MediaProcessingStep } from '@larkup/core/types';
import {
  describeActiveMediaStep,
  completedMediaProcessingSeconds,
  estimateMediaStepRemainingSeconds,
  formatMediaProgressPercent,
  isMediaStepTelemetryStale,
  primaryRunningMediaStep,
  isFinalizingMediaStep,
  advanceMediaProcessingProgress,
  smoothMediaProcessingProgress,
} from './progress';

describe('smoothMediaProcessingProgress', () => {
  it('stops projecting when the latest worker update is stale', () => {
    const startedAt = '2026-08-31T10:00:00.000Z';
    const asset = {
      processingStatus: 'processing',
      processingProgress: 42,
      processingSteps: [
        { stage: 'vision', status: 'running' as const, percent: 2, startedAt },
        { stage: 'synthesize', status: 'waiting' as const },
        { stage: 'index', status: 'waiting' as const },
      ],
    };

    const later = smoothMediaProcessingProgress(
      asset,
      new Date('2026-08-31T10:01:00.000Z').getTime(),
    );
    expect(later).toBe(42);
  });

  it('keeps the latest worker measurement as the confirmed source value', () => {
    const updatedAt = '2026-08-31T10:00:00.000Z';
    const asset = {
      processingStatus: 'processing',
      processingProgress: 0,
      processingSteps: [{ stage: 'download', status: 'running' as const, percent: 0, updatedAt }],
    };

    expect(
      smoothMediaProcessingProgress(asset, new Date('2026-08-31T10:00:19.000Z').getTime()),
    ).toBe(0);
  });

  it('eases a sparse worker jump over multiple browser ticks', () => {
    expect(advanceMediaProcessingProgress(0, 8, 250)).toBe(0.5);
    expect(advanceMediaProcessingProgress(0.5, 8, 250)).toBe(1);
  });

  it('keeps moving slowly only while fresh worker activity is present', () => {
    expect(advanceMediaProcessingProgress(0, 0, 1_000, true)).toBeCloseTo(0.099, 3);
    expect(advanceMediaProcessingProgress(0.099, 0, 1_000, false)).toBe(0.099);
  });

  it('does not animate a paused attempt or fabricate completion', () => {
    const asset = {
      processingStatus: 'processing',
      processingPaused: true,
      processingProgress: 27,
      processingSteps: [
        {
          stage: 'vision',
          status: 'running' as const,
          percent: 2,
          startedAt: '2026-08-31T10:00:00.000Z',
        },
      ],
    };
    expect(smoothMediaProcessingProgress(asset, Date.now())).toBe(27);
  });
});

describe('live progress precision', () => {
  it('preserves measured tenths in the weighted overall pipeline', () => {
    const steps: MediaProcessingStep[] = MEDIA_PIPELINE_STAGES.map((stage) => ({
      stage,
      status: 'waiting' as const,
      updatedAt: '2026-09-02T10:00:00.000Z',
    }));
    steps[0] = {
      ...steps[0],
      status: 'running',
      percent: 21,
    };

    expect(weightedProcessingProgress(steps)).toBe(1.8);
    expect(formatMediaProgressPercent(1.8)).toBe('1.8');
    expect(formatMediaProgressPercent(47)).toBe('47');
  });
});

describe('primaryRunningMediaStep', () => {
  it('shows the freshest running stage instead of the last stage in pipeline order', () => {
    const steps = [
      {
        stage: 'prepare',
        status: 'running' as const,
        updatedAt: '2026-09-01T10:00:10.000Z',
      },
      {
        stage: 'extract',
        status: 'running' as const,
        updatedAt: '2026-09-01T10:00:00.000Z',
      },
    ];
    expect(primaryRunningMediaStep(steps)?.stage).toBe('prepare');
  });
});

describe('isFinalizingMediaStep', () => {
  it('names Cloud source preparation as a determinate stage, not a fake finalization state', () => {
    const preparation = { stage: 'prepare', status: 'running' as const, percent: 46 };

    expect(isFinalizingMediaStep(preparation)).toBe(false);
    expect(describeActiveMediaStep(preparation)).toBe('Cloud video preparation · 46% this step');
  });

  it('does not promise imminent completion while visual indexing is still running', () => {
    const visualIndexing = { stage: 'vision', status: 'running' as const, percent: 99 };

    expect(isFinalizingMediaStep(visualIndexing)).toBe(false);
    expect(describeActiveMediaStep(visualIndexing)).toBe('Visual analysis · 99% this step');
  });

  it('uses finalizing only for a nearly complete final search-indexing step', () => {
    expect(isFinalizingMediaStep({ stage: 'index', status: 'running', percent: 98 })).toBe(true);
  });
});

describe('estimateMediaStepRemainingSeconds', () => {
  it('hides an expired single-digit remote estimate', () => {
    const now = Date.now();
    expect(
      estimateMediaStepRemainingSeconds(
        {
          stage: 'synthesize',
          status: 'running',
          updatedAt: new Date(now).toISOString(),
          estimatedRemainingSeconds: 1,
        },
        now,
      ),
    ).toBeNull();
  });
  it('estimates from completed count rather than an optimistic stage percent', () => {
    const startedAt = '2026-08-28T10:00:00.000Z';
    expect(
      estimateMediaStepRemainingSeconds(
        { stage: 'vision', status: 'running', percent: 99, current: 20, total: 100, startedAt },
        new Date('2026-08-28T10:02:00.000Z').getTime(),
      ),
    ).toBe(480);
  });

  it('does not invent an ETA before enough countable work has completed', () => {
    expect(
      estimateMediaStepRemainingSeconds({
        stage: 'vision',
        status: 'running',
        current: 1,
        total: 100,
        startedAt: '2026-08-28T10:00:00.000Z',
      }),
    ).toBeNull();
  });

  it('hides an expired or stale worker ETA instead of parking at one second', () => {
    const step = {
      stage: 'vision',
      status: 'running' as const,
      estimatedRemainingSeconds: 10,
      updatedAt: '2026-08-28T10:00:00.000Z',
    };
    const now = new Date('2026-08-28T10:00:25.000Z').getTime();
    expect(isMediaStepTelemetryStale(step, now)).toBe(true);
    expect(estimateMediaStepRemainingSeconds(step, now)).toBeNull();
  });
});

describe('completedMediaProcessingSeconds', () => {
  it('uses the persisted indexing attempt start and final step completion', () => {
    expect(
      completedMediaProcessingSeconds({
        processingStatus: 'completed',
        processingStartedAt: '2026-08-29T10:00:00.000Z',
        processingSteps: [
          {
            stage: 'index',
            status: 'completed',
            finishedAt: '2026-08-29T10:07:32.000Z',
          },
        ],
      }),
    ).toBe(452);
  });

  it('does not show a duration when a completed legacy asset lacks an attempt start', () => {
    expect(
      completedMediaProcessingSeconds({
        processingStatus: 'completed',
      }),
    ).toBeNull();
  });
});
