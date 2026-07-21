import { NextResponse } from 'next/server';
import { readConfig } from '@larkup/core/config-store';
import { SerperSearchResponse, SerperSearchItem } from '../google/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const config = await readConfig();
  const apiKey = config.braveApiKey;

  if (!apiKey) {
    return NextResponse.json(
      {
        error: 'Brave search is not configured. Set BRAVE_API_KEY in your environment.',
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

  const clampedPage = Math.max(1, Math.min(page, 10)); // Brave offset logic can be complex, just map page to offset
  const offset = (clampedPage - 1) * 10;

  try {
    const res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(
        query.trim(),
      )}&count=10&offset=${offset}`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': apiKey,
        },
        cache: 'no-store',
      },
    );

    const json = await res.json();

    if (!res.ok) {
      const msg = json.message ?? `Brave API error (${res.status})`;
      return NextResponse.json({ error: msg }, { status: res.status });
    }

    const items: SerperSearchItem[] = (json.web?.results ?? []).map((r: any) => ({
      url: r.url,
      title: r.title,
      description: r.description,
    }));

    const rawTotal = 100; // Brave doesn't give a total results count easily, cap at 100 for pagination
    const hasMore = items.length === 10 && clampedPage < 10;
    const totalPages = hasMore ? 10 : clampedPage;

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
    const msg = err instanceof Error ? err.message : 'Brave search failed.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET() {
  const config = await readConfig();
  const configured = Boolean(config.braveApiKey);
  return NextResponse.json({ configured });
}
