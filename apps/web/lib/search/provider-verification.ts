export const SEARCH_VERIFICATION_PROVIDERS = [
  'serper',
  'google',
  'tavily',
  'brave',
  'bing',
  'exa',
  'firecrawl',
] as const;

export type SearchVerificationProvider = (typeof SEARCH_VERIFICATION_PROVIDERS)[number];

export function isSearchVerificationProvider(
  provider: string,
): provider is SearchVerificationProvider {
  return SEARCH_VERIFICATION_PROVIDERS.includes(provider as SearchVerificationProvider);
}

export async function verifySearchProvider(
  provider: SearchVerificationProvider,
  apiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  if (provider === 'serper' || provider === 'google') {
    const res = await fetcher('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: 'test', num: 1 }),
    });
    if (!res.ok) throw new Error('Invalid Serper API Key');
    return;
  }

  if (provider === 'tavily') {
    const res = await fetcher('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ api_key: apiKey, query: 'test', search_depth: 'basic' }),
    });
    if (!res.ok) throw new Error('Invalid Tavily API Key');
    return;
  }

  if (provider === 'brave') {
    const res = await fetcher('https://api.search.brave.com/res/v1/web/search?q=test&count=1', {
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey,
      },
    });
    if (!res.ok) throw new Error('Invalid Brave API Key');
    return;
  }

  if (provider === 'bing') {
    const url = new URL('https://serpapi.com/search.json');
    url.searchParams.set('engine', 'bing');
    url.searchParams.set('q', 'test');
    url.searchParams.set('api_key', apiKey);

    const res = await fetcher(url);
    if (!res.ok) throw new Error('Invalid SerpApi Key for Bing');
    return;
  }

  if (provider === 'exa') {
    const res = await fetcher('https://api.exa.ai/search', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({ query: 'test', numResults: 1 }),
    });
    if (!res.ok) throw new Error('Invalid Exa API Key');
    return;
  }

  const res = await fetcher('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url: 'https://example.com', formats: ['markdown'] }),
  });
  if (res.status === 401) throw new Error('Invalid Firecrawl API Key');
}
