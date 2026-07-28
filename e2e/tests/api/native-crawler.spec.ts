import { expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readLocalState, startLocal, stopLocal } from '../../../packages/scraper/src/local-runtime';
import { isFirecrawlConfigured, searchWeb } from '../../../packages/scraper/src/firecrawl';
import {
  getNativeCrawlStatus,
  startNativeCrawl,
} from '../../../packages/scraper/src/native-crawler';

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

test('native crawler search returns public result URLs without Docker or an API key', async () => {
  const originalCwd = process.cwd();
  const originalFetch = globalThis.fetch;
  const workspace = await mkdtemp(path.join(tmpdir(), 'larkup-native-search-'));
  try {
    process.chdir(workspace);
    await startLocal();
    globalThis.fetch = (async () =>
      new Response(
        '<a href="https://example.com/result" class="search-link l1"><div class="title" title="Example result">Example result</div></a>',
        { status: 200, headers: { 'content-type': 'text/html' } },
      )) as typeof fetch;

    await expect(searchWeb('example query', 5)).resolves.toEqual([
      { url: 'https://example.com/result', title: 'Example result' },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    process.chdir(originalCwd);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('native crawler search falls back when its primary public source is rate-limited', async () => {
  const originalCwd = process.cwd();
  const originalFetch = globalThis.fetch;
  const workspace = await mkdtemp(path.join(tmpdir(), 'larkup-native-search-fallback-'));
  try {
    process.chdir(workspace);
    await startLocal();
    let requestCount = 0;
    globalThis.fetch = (async () => {
      requestCount++;
      if (requestCount === 1) return new Response('', { status: 429 });
      return new Response(
        '<rss><channel><item><title>Fallback result</title><link>https://example.com/fallback</link><description>Fallback description</description></item></channel></rss>',
        { status: 200, headers: { 'content-type': 'application/rss+xml' } },
      );
    }) as typeof fetch;

    await expect(searchWeb('example query', 5)).resolves.toEqual([
      {
        url: 'https://example.com/fallback',
        title: 'Fallback result',
        description: 'Fallback description',
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    process.chdir(originalCwd);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('native crawls keep independent state when several jobs start together', async () => {
  const originalCwd = process.cwd();
  const originalFetch = globalThis.fetch;
  const workspace = await mkdtemp(path.join(tmpdir(), 'larkup-native-crawl-state-'));
  try {
    process.chdir(workspace);
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      return new Response(`<html><title>${url}</title><body>Readable page</body></html>`, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }) as typeof fetch;

    const [first, second] = await Promise.all([
      startNativeCrawl('https://example.com/one', 1),
      startNativeCrawl('https://example.org/two', 1),
    ]);
    await expect(getNativeCrawlStatus(first)).resolves.toMatchObject({
      state: 'completed',
      completed: 1,
    });
    await expect(getNativeCrawlStatus(second)).resolves.toMatchObject({
      state: 'completed',
      completed: 1,
    });
  } finally {
    globalThis.fetch = originalFetch;
    process.chdir(originalCwd);
    await rm(workspace, { recursive: true, force: true });
  }
});
