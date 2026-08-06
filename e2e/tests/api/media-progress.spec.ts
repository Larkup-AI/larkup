import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  describeActiveMediaStep,
  primaryRunningMediaStep,
} from '../../../apps/web/lib/media-progress';

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

  test('renders one primary progress bar for each active job card', async () => {
    const source = await readFile(
      path.join(repoRoot, 'apps/web/components/data/media-panel.tsx'),
      'utf8',
    );
    const activeList = source.slice(
      source.indexOf('function ActiveIndexingList'),
      source.indexOf('function ActiveIndexingDescription'),
    );
    expect(activeList).toContain('<ActiveIndexingDescription asset={asset} />');
    expect(activeList).not.toContain('Overall indexing progress');
  });
});
