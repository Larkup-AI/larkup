"use client"

import useSWR from "swr"
import { ClipboardPaste, FileUp, Globe, Layers } from "lucide-react"
import type { CrawlJob, SourceDocument } from "@/core/types"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { ScrapePanel } from "@/components/data/scrape-panel"
import { PastePanel } from "@/components/data/paste-panel"
import { UploadPanel } from "@/components/data/upload-panel"
import { JobsPanel } from "@/components/data/jobs-panel"
import { CorpusPanel } from "@/components/data/corpus-panel"
import { FirecrawlNotice } from "@/components/data/firecrawl-notice"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface DocsResponse {
  documents: SourceDocument[]
  stats: { docCount: number; charCount: number; bySource: Record<string, number> }
}

/**
 * Fetch the job list, then advance every non-terminal job by hitting its status
 * endpoint (which pulls freshly-scraped pages and persists them). One SWR key
 * drives the whole live-crawl experience.
 */
async function fetchJobsWithSync(url: string): Promise<{
  jobs: CrawlJob[]
  configured: boolean
}> {
  const { jobs, configured } = (await fetcher(url)) as {
    jobs: CrawlJob[]
    configured: boolean
  }
  const active = jobs.filter(
    (j) => j.status === "running" || j.status === "queued",
  )
  if (active.length === 0) return { jobs, configured }

  const advanced = await Promise.all(
    active.map((j) =>
      fetch(`/api/jobs/${j.id}`)
        .then((r) => r.json())
        .then((d) => d.job as CrawlJob)
        .catch(() => j),
    ),
  )
  const map = new Map(advanced.map((j) => [j.id, j]))
  return { jobs: jobs.map((j) => map.get(j.id) ?? j), configured }
}

export function DataWorkspace() {
  const jobsQuery = useSWR("/api/jobs", fetchJobsWithSync, {
    refreshInterval: (data) =>
      data?.jobs.some((j) => j.status === "running" || j.status === "queued")
        ? 4000
        : 0,
  })
  const jobs = jobsQuery.data?.jobs ?? []
  const configured = jobsQuery.data?.configured ?? true
  const hasActive = jobs.some(
    (j) => j.status === "running" || j.status === "queued",
  )

  const docsQuery = useSWR<DocsResponse>("/api/documents", fetcher, {
    // While a crawl runs, keep the corpus fresh as new docs land.
    refreshInterval: hasActive ? 5000 : 0,
  })
  const documents = docsQuery.data?.documents ?? []
  const stats = docsQuery.data?.stats

  const refreshAll = () => {
    jobsQuery.mutate()
    docsQuery.mutate()
  }

  return (
    <div className="px-6 py-6 md:px-8">
      <div className="mb-6">
        <FirecrawlNotice cloudConfigured={configured} onChange={refreshAll} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3 lg:items-stretch">
        {/* Ingest */}
        <div className="lg:col-span-2 flex flex-col">
          <Card className="flex flex-col flex-1">
            <CardHeader>
              <CardTitle className="text-base">Load data</CardTitle>
            </CardHeader>
            <CardContent className="flex-1">
              <Tabs defaultValue="scrape">
                <TabsList>
                  <TabsTrigger value="scrape">
                    <Globe className="size-4" />
                    Web scrape
                  </TabsTrigger>
                  <TabsTrigger value="paste">
                    <ClipboardPaste className="size-4" />
                    Paste text
                  </TabsTrigger>
                  <TabsTrigger value="upload">
                    <FileUp className="size-4" />
                    Upload files
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="scrape" className="pt-5">
                  <ScrapePanel disabled={!configured} onStarted={refreshAll} />
                </TabsContent>
                <TabsContent value="paste" className="pt-5">
                  <PastePanel onAdded={refreshAll} />
                </TabsContent>
                <TabsContent value="upload" className="pt-5">
                  <UploadPanel onAdded={refreshAll} />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>

        {/* Jobs */}
        <div className="lg:col-span-1 flex flex-col">
          <Card className="flex flex-col flex-1">
            <CardHeader className="flex-row items-center justify-between shrink-0">
              <CardTitle className="text-base">ETL jobs</CardTitle>
              {hasActive && (
                <span className="flex items-center gap-1.5 text-xs text-primary">
                  <span className="relative flex size-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                    <span className="relative inline-flex size-2 rounded-full bg-primary" />
                  </span>
                  live
                </span>
              )}
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto min-h-0">
              {jobsQuery.isLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
              ) : (
                <JobsPanel jobs={jobs} onChanged={refreshAll} />
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Corpus */}
      <Card className="mt-6">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="size-4 text-primary" />
            Corpus
          </CardTitle>
          {stats && (
            <div className="flex items-center gap-4 text-xs text-muted-foreground tabular-nums">
              <span>{stats.docCount.toLocaleString()} docs</span>
              <span>{stats.charCount.toLocaleString()} chars</span>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {docsQuery.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <CorpusPanel documents={documents} onChanged={refreshAll} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
