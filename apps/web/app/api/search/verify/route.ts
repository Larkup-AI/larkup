import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { provider, apiKey } = await req.json();

    if (!provider || !apiKey) {
      return NextResponse.json({ error: 'Provider and API key are required' }, { status: 400 });
    }

    if (provider === 'serper' || provider === 'google') {
      const res = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ q: 'test', num: 1 }),
      });
      if (!res.ok) throw new Error('Invalid Serper API Key');
      return NextResponse.json({ success: true });
    }

    if (provider === 'tavily') {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ api_key: apiKey, query: 'test', search_depth: 'basic' }),
      });
      if (!res.ok) throw new Error('Invalid Tavily API Key');
      return NextResponse.json({ success: true });
    }

    if (provider === 'brave') {
      const res = await fetch('https://api.search.brave.com/res/v1/web/search?q=test&count=1', {
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': apiKey,
        },
      });
      if (!res.ok) throw new Error('Invalid Brave API Key');
      return NextResponse.json({ success: true });
    }

    if (provider === 'bing') {
      const res = await fetch(
        `https://serpapi.com/search.json?engine=bing&q=test&api_key=${apiKey}`,
      );
      if (!res.ok) throw new Error('Invalid SerpApi Key for Bing');
      return NextResponse.json({ success: true });
    }

    if (provider === 'exa') {
      const res = await fetch('https://api.exa.ai/search', {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify({ query: 'test', numResults: 1 }),
      });
      if (!res.ok) throw new Error('Invalid Exa API Key');
      return NextResponse.json({ success: true });
    }

    if (provider === 'firecrawl') {
      const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: 'https://example.com', formats: ['markdown'] }),
      });
      if (res.status === 401) throw new Error('Invalid Firecrawl API Key');
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Unsupported provider' }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Verification failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
