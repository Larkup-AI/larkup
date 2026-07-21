import { NextResponse } from 'next/server';
import { readConfig } from '@larkup/core/config-store';
import { SerperSearchResponse, SerperSearchItem } from '../google/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const config = await readConfig();
  const apiKey = config.tavilyApiKey;

  if (!apiKey) {
    return NextResponse.json(
      {
        error: 'Tavily search is not configured. Set TAVILY_API_KEY in your environment.',
        configured: false,
      },
      { status: 503 },
    );
  }

  let body: { query?: string; page?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const { query, page = 1 } = body;
  if (!query?.trim()) {
    return NextResponse.json({ error: 'A search query is required.' }, { status: 400 });
  }

  // Tavily does not have a direct "page" param, we'll just do a basic search
  // It returns up to 5-10 results depending on depth. We will ignore pagination for Tavily
  // or return hasMore = false.

  if (page > 1) {
    return NextResponse.json({
      items: [],
      totalResults: 0,
      totalResultsIsEstimate: true,
      currentPage: page,
      totalPages: 1,
      hasMore: false,
      query: query.trim(),
    });
  }

  try {
    const res = await fetch(`https://api.tavily.com/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ api_key: apiKey, query: query.trim(), search_depth: 'basic' }),
      cache: 'no-store',
    });

    const json = await res.json();

    if (!res.ok || json.error) {
      const msg = json.error ?? `Tavily API error (${res.status})`;
      return NextResponse.json({ error: msg }, { status: res.status });
    }

    const items: SerperSearchItem[] = (json.results ?? []).map((r: any) => ({
      url: r.url,
      title: r.title,
      description: r.content,
    }));

    const rawTotal = items.length;

    return NextResponse.json({
      items,
      totalResults: rawTotal,
      totalResultsIsEstimate: true,
      currentPage: 1,
      totalPages: 1,
      hasMore: false,
      query: query.trim(),
    } satisfies SerperSearchResponse & { totalResultsIsEstimate: boolean });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Tavily search failed.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET() {
  const config = await readConfig();
  const configured = Boolean(config.tavilyApiKey);
  return NextResponse.json({ configured });
}
