import { expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readLocalState, startLocal, stopLocal } from '../../../packages/scraper/src/local-runtime';
import { isFirecrawlConfigured } from '../../../packages/scraper/src/firecrawl';

test('curl-style local install starts the built-in crawler without Docker', async () => {
  const originalCwd = process.cwd();
  const workspace = await mkdtemp(path.join(tmpdir(), 'larkup-native-crawler-'));
  try {
    process.chdir(workspace);
    const state = await startLocal();

    expect(state.running).toBe(true);
    expect(state.mode).toBe('native');
    expect(state.endpoint).toBe('native://larkup-crawler');
    await expect(isFirecrawlConfigured()).resolves.toBe(true);

    await stopLocal();
    await expect(readLocalState()).resolves.toMatchObject({ running: false, mode: 'native' });
  } finally {
    process.chdir(originalCwd);
    await rm(workspace, { recursive: true, force: true });
  }
});
