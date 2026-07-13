import { NextResponse } from "next/server"
import { randomUUID } from "node:crypto"
import { readJobs, saveJob } from "@larkup/core/jobs-store"
import { syncJob } from "@larkup/scraper/job-runner"
import { isFirecrawlConfigured } from "@larkup/scraper/firecrawl"
import { readDocuments } from "@larkup/core/documents-store"
import type { CrawlJob, CrawlScope, CrawlTarget } from "@larkup/core/types"

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

  const docs = await readDocuments()
  const existingUrls = new Set(docs.filter(d => d.url).map(d => d.url!))

  const baseMap = new Map<string, CrawlTarget>()
  const pathMap = new Map<string, CrawlTarget>()

  ;(body.targets ?? []).forEach((t) => {
    if (!t.url || !/^https?:\/\//i.test(t.url)) return

    try {
      const u = new URL(t.url)
      const origin = u.origin

      // Add base if not existing
      if (!existingUrls.has(origin) && !existingUrls.has(origin + '/')) {
        baseMap.set(origin, {
          url: origin,
          scope: t.scope === "domain" ? "domain" : "page",
          status: "queued",
          pagesCrawled: 0,
        })
      }

      // Add specific path if not origin and not existing
      if (t.url !== origin && t.url !== origin + '/') {
        if (!existingUrls.has(t.url)) {
          pathMap.set(t.url, {
            url: t.url,
            scope: t.scope === "domain" ? "domain" : "page",
            status: "queued",
            pagesCrawled: 0,
          })
        }
      }
    } catch {
      // Fallback for weird URLs
      if (!existingUrls.has(t.url)) {
        pathMap.set(t.url, {
          url: t.url,
          scope: t.scope === "domain" ? "domain" : "page",
          status: "queued",
          pagesCrawled: 0,
        })
      }
    }
  })

  const cleaned = [...Array.from(baseMap.values()), ...Array.from(pathMap.values())]

  if (cleaned.length === 0) {
    return NextResponse.json(
      { error: "Select at least one valid new URL to scrape." },
      { status: 400 },
    )
  }

  const job: CrawlJob = {
    id: randomUUID(),
    keywords: body.keywords?.trim() || cleaned[0].url,
    targets: cleaned,
    status: "queued",
    pageLimit: Math.min(Math.max(body.pageLimit ?? 2000, 1), 2000),
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
