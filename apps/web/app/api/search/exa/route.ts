import { NextResponse } from 'next/server';
import { readConfig } from '@larkup/core/config-store';
import { SerperSearchResponse, SerperSearchItem } from '../google/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const config = await readConfig();
  const apiKey = config.exaApiKey;

  if (!apiKey) {
    return NextResponse.json(
      {
        error: 'Exa search is not configured. Set EXA_API_KEY in your environment.',
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
    const res = await fetch(`https://api.exa.ai/search`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        query: query.trim(),
        numResults: 10,
        useAutoprompt: true,
        contents: {
          text: {
            maxCharacters: 500,
          },
        },
      }),
      cache: 'no-store',
    });

    const json = await res.json();

    if (!res.ok || json.error) {
      const msg = json.error ?? `Exa API error (${res.status})`;
      return NextResponse.json({ error: msg }, { status: res.status });
    }

    const items: SerperSearchItem[] = (json.results ?? []).map((r: any) => ({
      url: r.url,
      title: r.title,
      description: r.text || r.summary || r.title,
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
    const msg = err instanceof Error ? err.message : 'Exa search failed.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET() {
  const config = await readConfig();
  const configured = Boolean(config.exaApiKey);
  return NextResponse.json({ configured });
}
