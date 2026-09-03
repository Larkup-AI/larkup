import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  describeActiveMediaStep,
  estimateMediaStepRemainingSeconds,
  mediaProcessingStartedAt,
  primaryRunningMediaStep,
} from '../../../apps/web/lib/media/progress';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test.describe('media indexing progress', () => {
  test('reports the measured primary stage separately from weighted overall progress', () => {
    const step = primaryRunningMediaStep([
      { stage: 'transcribe', status: 'running' as const, current: 2, total: 5, unit: 'parts' },
      { stage: 'vision', status: 'running' as const, current: 18, total: 43, unit: 'sequences' },
    ]);
    expect(describeActiveMediaStep(step)).toBe(
      'Visual analysis · 18 / 43 sequences · 42% this step',
    );
    expect(describeActiveMediaStep({ stage: 'synthesize', status: 'running' })).toBe(
      'Knowledge notes · active request in progress',
    );
  });

  test('uses the current processing attempt as the elapsed-time baseline after retry', () => {
    expect(
      mediaProcessingStartedAt({
        createdAt: '2026-01-01T00:00:00.000Z',
        processingStartedAt: '2026-01-01T01:00:00.000Z',
      }),
    ).toBe('2026-01-01T01:00:00.000Z');
    expect(mediaProcessingStartedAt({ createdAt: '2026-01-01T00:00:00.000Z' })).toBe(
      '2026-01-01T00:00:00.000Z',
    );
  });

  test('counts down the runtime ETA only between fresh worker heartbeats', () => {
    expect(
      estimateMediaStepRemainingSeconds(
        {
          stage: 'vision',
          status: 'running',
          estimatedRemainingSeconds: 180,
          updatedAt: '2026-09-01T10:00:00.000Z',
        },
        new Date('2026-09-01T10:00:10.000Z').getTime(),
      ),
    ).toBe(170);
    expect(
      estimateMediaStepRemainingSeconds(
        {
          stage: 'vision',
          status: 'running',
          estimatedRemainingSeconds: 180,
          updatedAt: '2026-09-01T10:00:00.000Z',
        },
        new Date('2026-09-01T10:00:30.000Z').getTime(),
      ),
    ).toBeNull();
  });

  test('renders one primary progress bar for each active job card', async () => {
    const source = await readFile(
      path.join(repoRoot, 'apps/web/components/data/media-panel.tsx'),
      'utf8',
    );
    const activeList = source.slice(
      source.indexOf('function ActiveIndexingList'),
      source.indexOf('function ActiveIndexingDescription'),
    );
    const liveProgress = await readFile(
      path.join(repoRoot, 'apps/web/components/data/live-media-progress.tsx'),
      'utf8',
    );
    expect(activeList).toContain('<ActiveIndexingDescription asset={asset} />');
    expect(activeList).toContain('<LiveMediaProgress');
    expect(liveProgress).toContain('aria-label={label}');
    expect(liveProgress).toContain('data-testid="live-indexing-progress-pulse"');
    expect(liveProgress).toContain('`${formatted}% progress, worker activity`');
  });
});
