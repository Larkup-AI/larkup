import { promises as fs } from "node:fs"
import path from "node:path"
import type { CrawlJob } from "./types"
import { getDataDir, requireDataDir } from "./workspace"

/**
 * File-backed store for crawl/ETL jobs, scoped to the active server.
 *
 * Job state lives on disk so progress survives restarts during a long-running
 * crawl. Writes are serialized through a small in-process chain.
 */

let writeChain: Promise<unknown> = Promise.resolve()
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn)
  writeChain = run.catch(() => {})
  return run
}

async function jobsPath(create: boolean): Promise<string | null> {
  const dir = create ? await requireDataDir() : await getDataDir()
  if (!dir) return null
  return path.join(dir, "jobs.json")
}

export async function readJobs(): Promise<CrawlJob[]> {
  const file = await jobsPath(false)
  if (!file) return []
  try {
    const raw = await fs.readFile(file, "utf8")
    return JSON.parse(raw) as CrawlJob[]
  } catch {
    return []
  }
}

async function writeAll(jobs: CrawlJob[]) {
  const file = await jobsPath(true)
  if (!file) return
  await fs.writeFile(file, JSON.stringify(jobs, null, 2), "utf8")
}

export async function getJob(id: string): Promise<CrawlJob | undefined> {
  const jobs = await readJobs()
  return jobs.find((j) => j.id === id)
}

export function saveJob(job: CrawlJob) {
  return serialize(async () => {
    const jobs = await readJobs()
    const idx = jobs.findIndex((j) => j.id === job.id)
    const next = { ...job, updatedAt: new Date().toISOString() }
    if (idx >= 0) jobs[idx] = next
    else jobs.unshift(next)
    await writeAll(jobs)
    return next
  })
}

/**
 * Read-modify-write a single job atomically (relative to other store writes).
 * Returns the updated job, or undefined if it no longer exists.
 */
export function updateJob(
  id: string,
  mutate: (job: CrawlJob) => CrawlJob,
): Promise<CrawlJob | undefined> {
  return serialize(async () => {
    const jobs = await readJobs()
    const idx = jobs.findIndex((j) => j.id === id)
    if (idx < 0) return undefined
    const next = { ...mutate(jobs[idx]), updatedAt: new Date().toISOString() }
    jobs[idx] = next
    await writeAll(jobs)
    return next
  })
}

export function deleteJob(id: string) {
  return serialize(async () => {
    const jobs = await readJobs()
    await writeAll(jobs.filter((j) => j.id !== id))
  })
}
