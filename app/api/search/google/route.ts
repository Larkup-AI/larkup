import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export interface SerperSearchItem {
  url: string
  title: string
  description?: string
}

export interface SerperSearchResponse {
  items: SerperSearchItem[]
  totalResults: number
  currentPage: number
  totalPages: number
  hasMore: boolean
  query: string
}

/**
 * POST { query, page } → paginated Serper.dev Google Search results with total count.
 *
 * Uses the Serper.dev API: https://serper.dev
 * Much simpler than Google CSE — only one env var needed.
 *
 * Required env var:
 *   SERPER_API_KEY  – from https://serper.dev → API Key tab
 *
 * Serper returns up to 100 results (10 per page, page 1–10).
 */
export async function POST(req: Request) {
  const apiKey = process.env.SERPER_API_KEY

  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "Serper search is not configured. Set SERPER_API_KEY in your environment.",
        configured: false,
      },
      { status: 503 },
    )
  }

  let body: { query?: string; page?: number }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 })
  }

  const { query, page = 1 } = body
  if (!query?.trim()) {
    return NextResponse.json(
      { error: "A search query is required." },
      { status: 400 },
    )
  }

  const clampedPage = Math.max(1, Math.min(page, 10))

  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: query.trim(),
        num: 10,
        page: clampedPage,
      }),
      cache: "no-store",
    })

    const json = (await res.json()) as {
      error?: string
      /** Serper free plan does NOT include searchInformation — we derive pagination from organic count. */
      searchInformation?: {
        totalResults?: number | string
        formattedTotalResults?: string
        timeTakenDisplayed?: number
      }
      organic?: Array<{
        link?: string
        title?: string
        snippet?: string
        position?: number
      }>
    }

    if (!res.ok || json.error) {
      const msg = json.error ?? `Serper API error (${res.status})`
      return NextResponse.json({ error: msg }, { status: res.status })
    }

    const items: SerperSearchItem[] = (json.organic ?? [])
      .filter((r) => r.link)
      .map((r) => ({
        url: r.link!,
        title: r.title ?? r.link!,
        description: r.snippet,
      }))

    // Serper's free plan omits searchInformation.totalResults.
    // We derive pagination heuristically:
    //   • A full page (10 results) means there are likely more pages.
    //   • We cap at 10 pages (100 results) — Serper's max accessible window.
    //   • If fewer than 10 results returned, this is the last page.
    const gotFullPage = items.length >= 10
    const hasMore = gotFullPage && clampedPage < 10

    // Derive a synthetic total: current page offset + items on this page,
    // plus "+?" if we believe there are more pages.
    const minTotal = (clampedPage - 1) * 10 + items.length
    // If searchInformation is present (cloud/enterprise plan), use it.
    const siTotal = json.searchInformation?.totalResults
    const rawTotal =
      siTotal != null
        ? typeof siTotal === "string"
          ? parseInt(siTotal, 10) || minTotal
          : siTotal
        : minTotal

    // Total pages: if we know the real count, cap at 10; otherwise estimate.
    const totalPages = siTotal != null
      ? Math.min(Math.max(1, Math.ceil(Math.min(rawTotal, 100) / 10)), 10)
      : hasMore
        ? 10   // unknown upper bound — show up to 10 pages
        : clampedPage  // last page reached

    return NextResponse.json({
      items,
      totalResults: rawTotal,
      // Pass along whether totalResults is an estimate
      totalResultsIsEstimate: siTotal == null,
      currentPage: clampedPage,
      totalPages,
      hasMore,
      query: query.trim(),
    } satisfies SerperSearchResponse & { totalResultsIsEstimate: boolean })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Serper search failed."
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

/** GET → whether Serper search is configured. */
export async function GET() {
  const configured = Boolean(process.env.SERPER_API_KEY)
  return NextResponse.json({ configured })
}
