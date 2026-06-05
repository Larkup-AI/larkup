import { NextResponse } from "next/server"
import { searchWeb, isFirecrawlConfigured, FirecrawlError } from "@/core/scraper/firecrawl"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** GET → report whether the scraper is configured (drives the setup notice). */
export async function GET() {
  return NextResponse.json({ configured: await isFirecrawlConfigured() })
}

/** POST { query, limit } → keyword web search returning candidate URLs. */
export async function POST(req: Request) {
  try {
    const { query, limit } = (await req.json()) as {
      query?: string
      limit?: number
    }
    if (!query || !query.trim()) {
      return NextResponse.json({ error: "A search query is required." }, { status: 400 })
    }
    const results = await searchWeb(query.trim(), Math.min(limit ?? 10, 25))
    return NextResponse.json({ results })
  } catch (err) {
    const status = err instanceof FirecrawlError ? err.status ?? 500 : 500
    const message = err instanceof Error ? err.message : "Search failed."
    return NextResponse.json({ error: message }, { status })
  }
}
