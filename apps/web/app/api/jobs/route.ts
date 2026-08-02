import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { readJobs, saveJob } from '@larkup/core/jobs-store';
import { isFirecrawlConfigured } from '@larkup/scraper/firecrawl';
import { readDocuments } from '@larkup/core/documents-store';
import type { CrawlJob, CrawlScope, CrawlTarget } from '@larkup/core/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET → all crawl jobs, newest first. */
export async function GET() {
  const jobs = await readJobs();
  return NextResponse.json({ jobs, configured: await isFirecrawlConfigured() });
}

/**
 * POST → start a new ETL job.
 * Body: { keywords, targets: [{ url, scope }], pageLimit }
 */
export async function POST(req: Request) {
  if (!(await isFirecrawlConfigured())) {
    return NextResponse.json(
      {
        error: 'No web crawler is available. Choose and configure a crawler provider in Settings.',
      },
      { status: 401 },
    );
  }

  let body: {
    keywords?: string;
    targets?: Array<{ url?: string; scope?: CrawlScope }>;
    pageLimit?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const docs = await readDocuments();
  const existingUrls = new Set(docs.filter((d) => d.url).map((d) => d.url!));

  const targets = new Map<string, CrawlTarget>();

  (body.targets ?? []).forEach((t) => {
    if (!t.url || !/^https?:\/\//i.test(t.url)) return;

    try {
      const u = new URL(t.url);
      const origin = u.origin;

      // A page request must scrape the exact selected page. For a domain
      // crawl, begin at the site root so the frontier can discover the site.
      const scope = t.scope === 'domain' ? 'domain' : 'page';
      const targetUrl = scope === 'domain' ? origin : u.toString();
      if (!existingUrls.has(targetUrl)) {
        targets.set(targetUrl, {
          url: targetUrl,
          scope,
          status: 'queued',
          pagesCrawled: 0,
        });
      }
    } catch {
      // Fallback for weird URLs
      if (!existingUrls.has(t.url)) {
        targets.set(t.url, {
          url: t.url,
          scope: t.scope === 'domain' ? 'domain' : 'page',
          status: 'queued',
          pagesCrawled: 0,
        });
      }
    }
  });

  const cleaned = [...targets.values()];

  if (cleaned.length === 0) {
    return NextResponse.json(
      { error: 'Select at least one valid new URL to scrape.' },
      { status: 400 },
    );
  }

  const job: CrawlJob = {
    id: randomUUID(),
    keywords: body.keywords?.trim() || cleaned[0].url,
    targets: cleaned,
    status: 'queued',
    pageLimit: Math.min(Math.max(body.pageLimit ?? 2000, 1), 2000),
    pagesCrawled: 0,
    docCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await saveJob(job);
  // Job advancement happens through the existing status polling endpoint. Do
  // not wait for a crawler request here: a slow site used to leave the Start
  // button feeling unresponsive and hid the newly queued job from the UI.
  return NextResponse.json({ job }, { status: 201 });
}
