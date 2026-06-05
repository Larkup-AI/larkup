import { NextResponse } from "next/server"
import { deleteJob, getJob } from "@buddy-rag/core/jobs-store"
import { cancelJob, syncJob } from "@buddy-rag/core/scraper/job-runner"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET → advance the job one increment (pull newly-scraped pages, persist them)
 * and return the latest state. The UI polls this on an interval, which is how a
 * long-running crawl streams documents into the corpus.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const job = await syncJob(id)
  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 })
  }
  return NextResponse.json({ job })
}

/** DELETE → cancel a running job, or remove a finished one (?remove=1). */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const remove = new URL(req.url).searchParams.get("remove")

  if (remove) {
    await deleteJob(id)
    return NextResponse.json({ ok: true })
  }

  const existing = await getJob(id)
  if (!existing) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 })
  }
  const job = await cancelJob(id)
  return NextResponse.json({ job })
}
