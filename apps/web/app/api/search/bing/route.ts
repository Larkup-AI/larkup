import { NextResponse } from 'next/server';
import { readConfig } from '@larkup/core/config-store';
import { SerperSearchResponse, SerperSearchItem } from '../google/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const config = await readConfig();
  const apiKey = config.bingApiKey;

  if (!apiKey) {
    return NextResponse.json(
      {
        error: 'Bing search is not configured. Set BING_API_KEY in your environment.',
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

  const clampedPage = Math.max(1, Math.min(page, 10));
  const offset = (clampedPage - 1) * 10;

  try {
    const res = await fetch(
      `https://serpapi.com/search.json?engine=bing&q=${encodeURIComponent(query.trim())}&first=${
        offset + 1
      }&api_key=${apiKey}`,
      {
        method: 'GET',
        cache: 'no-store',
      },
    );

    const json = await res.json();

    if (!res.ok || json.error) {
      const msg = json.error ?? `Bing (SerpApi) error (${res.status})`;
      return NextResponse.json({ error: msg }, { status: res.status });
    }

    const items: SerperSearchItem[] = (json.organic_results ?? []).map((r: any) => ({
      url: r.link,
      title: r.title,
      description: r.snippet,
    }));

    // SerpApi doesn't easily expose total results for Bing sometimes, but we can check if there's a next page or just estimate
    const rawTotal = 100; // Fake a large number for pagination
    const gotFullPage = items.length >= 10; // Assuming 10 results per page default
    const hasMore = gotFullPage && clampedPage < 10;

    const totalPages = hasMore ? clampedPage + 1 : clampedPage;

    return NextResponse.json({
      items,
      totalResults: rawTotal,
      totalResultsIsEstimate: true,
      currentPage: clampedPage,
      totalPages,
      hasMore,
      query: query.trim(),
    } satisfies SerperSearchResponse & { totalResultsIsEstimate: boolean });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Bing search failed.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET() {
  const config = await readConfig();
  const configured = Boolean(config.bingApiKey);
  return NextResponse.json({ configured });
}
