import { test, expect } from '@playwright/test';
import {
  type SearchVerificationProvider,
  verifySearchProvider,
} from '../../../apps/web/lib/search-provider-verification';

test.describe('Search verification API (/api/search/verify)', () => {
  test('rejects missing credentials', async ({ request }) => {
    for (const data of [{}, { provider: 'exa' }, { apiKey: 'test-key' }]) {
      const response = await request.post('/api/search/verify', { data });

      expect(response.status()).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: 'Provider and API key are required',
      });
    }
  });

  test('rejects unsupported providers before making an upstream request', async ({ request }) => {
    const response = await request.post('/api/search/verify', {
      data: { provider: 'unsupported', apiKey: 'test-key' },
    });

    expect(response.status()).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Unsupported provider' });
  });
});

test.describe('Search provider verification requests', () => {
  const cases: Array<{
    provider: SearchVerificationProvider;
    expectedUrl: string;
    assertRequest: (url: URL, init?: RequestInit) => void;
  }> = [
    {
      provider: 'serper',
      expectedUrl: 'https://google.serper.dev/search',
      assertRequest: (_url, init) => {
        expect(init?.method).toBe('POST');
        expect(new Headers(init?.headers).get('X-API-KEY')).toBe('test-key');
        expect(JSON.parse(String(init?.body))).toEqual({ q: 'test', num: 1 });
      },
    },
    {
      provider: 'google',
      expectedUrl: 'https://google.serper.dev/search',
      assertRequest: (_url, init) => {
        expect(new Headers(init?.headers).get('X-API-KEY')).toBe('test-key');
      },
    },
    {
      provider: 'tavily',
      expectedUrl: 'https://api.tavily.com/search',
      assertRequest: (_url, init) => {
        expect(JSON.parse(String(init?.body))).toEqual({
          api_key: 'test-key',
          query: 'test',
          search_depth: 'basic',
        });
      },
    },
    {
      provider: 'brave',
      expectedUrl: 'https://api.search.brave.com/res/v1/web/search?q=test&count=1',
      assertRequest: (_url, init) => {
        expect(new Headers(init?.headers).get('X-Subscription-Token')).toBe('test-key');
      },
    },
    {
      provider: 'bing',
      expectedUrl: 'https://serpapi.com/search.json?engine=bing&q=test&api_key=test-key',
      assertRequest: (url) => {
        expect(url.searchParams.get('engine')).toBe('bing');
        expect(url.searchParams.get('api_key')).toBe('test-key');
      },
    },
    {
      provider: 'exa',
      expectedUrl: 'https://api.exa.ai/search',
      assertRequest: (_url, init) => {
        expect(new Headers(init?.headers).get('x-api-key')).toBe('test-key');
        expect(JSON.parse(String(init?.body))).toEqual({ query: 'test', numResults: 1 });
      },
    },
    {
      provider: 'firecrawl',
      expectedUrl: 'https://api.firecrawl.dev/v1/scrape',
      assertRequest: (_url, init) => {
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-key');
        expect(JSON.parse(String(init?.body))).toEqual({
          url: 'https://example.com',
          formats: ['markdown'],
        });
      },
    },
  ];

  for (const { provider, expectedUrl, assertRequest } of cases) {
    test(`builds the ${provider} verification request`, async () => {
      let calls = 0;
      const fetcher: typeof fetch = async (input, init) => {
        calls += 1;
        const url = new URL(input instanceof Request ? input.url : input.toString());
        expect(url.toString()).toBe(expectedUrl);
        assertRequest(url, init);
        return new Response('{}', { status: 200 });
      };

      await verifySearchProvider(provider, 'test-key', fetcher);
      expect(calls).toBe(1);
    });
  }

  test('reports rejected credentials', async () => {
    const fetcher: typeof fetch = async () => new Response('{}', { status: 401 });

    await expect(verifySearchProvider('exa', 'bad-key', fetcher)).rejects.toThrow(
      'Invalid Exa API Key',
    );
    await expect(verifySearchProvider('firecrawl', 'bad-key', fetcher)).rejects.toThrow(
      'Invalid Firecrawl API Key',
    );
  });
});
