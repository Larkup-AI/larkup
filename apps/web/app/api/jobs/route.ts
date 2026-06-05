import { NextResponse } from "next/server"
import { randomUUID } from "node:crypto"
import { readJobs, saveJob } from "@buddy-rag/core/jobs-store"
import { syncJob } from "@buddy-rag/scraper/job-runner"
import { isFirecrawlConfigured } from "@buddy-rag/scraper/firecrawl"
import type { CrawlJob, CrawlScope, CrawlTarget } from "@buddy-rag/core/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** GET → all crawl jobs, newest first. */
export async function GET() {
  const jobs = await readJobs()
  return NextResponse.json({ jobs, configured: await isFirecrawlConfigured() })
}

/**
 * POST → start a new ETL job.
 * Body: { keywords, targets: [{ url, scope }], pageLimit }
 */
export async function POST(req: Request) {
  if (!(await isFirecrawlConfigured())) {
    return NextResponse.json(
      {
        error:
          "No Firecrawl available. Launch a local instance or set FIRECRAWL_API_KEY to run scraping jobs.",
      },
      { status: 401 },
    )
  }

  let body: {
    keywords?: string
    targets?: Array<{ url?: string; scope?: CrawlScope }>
    pageLimit?: number
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 })
  }

  const cleaned = (body.targets ?? [])
    .filter((t) => t.url && /^https?:\/\//i.test(t.url))
    .map<CrawlTarget>((t) => ({
      url: t.url as string,
      scope: t.scope === "domain" ? "domain" : "page",
      status: "queued",
      pagesCrawled: 0,
    }))

  if (cleaned.length === 0) {
    return NextResponse.json(
      { error: "Select at least one valid URL to scrape." },
      { status: 400 },
    )
  }

  const job: CrawlJob = {
    id: randomUUID(),
    keywords: body.keywords?.trim() || cleaned[0].url,
    targets: cleaned,
    status: "queued",
    pageLimit: Math.min(Math.max(body.pageLimit ?? 25, 1), 500),
    pagesCrawled: 0,
    docCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  await saveJob(job)
  // Kick the job once so domain crawls start and single pages scrape immediately.
  const advanced = await syncJob(job.id)
  return NextResponse.json({ job: advanced ?? job }, { status: 201 })
}
