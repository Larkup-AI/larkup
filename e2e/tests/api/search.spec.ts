import { test, expect } from '@playwright/test';
import { hasEnv, ENV_KEYS } from '../../utils/env-loader';

test.describe('Search API (/api/search)', () => {
  test('GET /api/search — check configured status', async ({ request }) => {
    const res = await request.get('/api/search');
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('configured');
    console.log(`  ✓ Search configured: ${body.configured}`);
  });

  test('POST /api/search — empty query returns 400', async ({ request }) => {
    const res = await request.post('/api/search', {
      data: { query: '' },
    });

    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    console.log('  ✓ Empty search query correctly rejected (400)');
  });

  test('POST /api/search — valid query returns results', async ({ request }) => {
    test.skip(
      !hasEnv(ENV_KEYS.FIRECRAWL_CLOUD_API_KEY) && !hasEnv(ENV_KEYS.SERPER_API_KEY),
      'No search API key configured',
    );
    test.setTimeout(30_000);

    const res = await request.post('/api/search', {
      data: { query: 'Larkup', limit: 5 },
    });

    // May return 401 if firecrawl isn't configured, which is valid
    if (res.status() === 401) {
      console.log('  ⚠ Firecrawl not configured (401) — expected if no local instance');
      return;
    }

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('results');
    console.log(`  ✓ Search returned ${body.results?.length ?? 0} results`);
  });
});
