"use client";

import { useState, useEffect, useRef } from "react";
import useSWR, { useSWRConfig } from "swr";
import { ClipboardPaste, FileUp, Globe, Layers, Plus } from "lucide-react";
import { toast } from "sonner";
import type { CrawlJob, SourceDocument } from "@larkup/core/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

import { ScrapePanel } from "@/components/data/scrape-panel";
import { PastePanel } from "@/components/data/paste-panel";
import { UploadPanel } from "@/components/data/upload-panel";
import { JobsPanel } from "@/components/data/jobs-panel";
import { CorpusPanel } from "@/components/data/corpus-panel";
import { FirecrawlNotice } from "@/components/data/firecrawl-notice";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface DocsResponse {
  documents: SourceDocument[];
  stats: {
    docCount: number;
    charCount: number;
    bySource: Record<string, number>;
  };
}

async function fetchJobsWithSync(url: string): Promise<{
  jobs: CrawlJob[];
  configured: boolean;
}> {
  const { jobs, configured } = (await fetcher(url)) as {
    jobs: CrawlJob[];
    configured: boolean;
  };
  const active = jobs.filter(
    (j) => j.status === "running" || j.status === "queued",
  );
  if (active.length === 0) return { jobs, configured };

  const advanced = await Promise.all(
    active.map((j) =>
      fetch(`/api/jobs/${j.id}`)
        .then((r) => r.json())
        .then((d) => d.job as CrawlJob)
        .catch(() => j),
    ),
  );
  const map = new Map(advanced.map((j) => [j.id, j]));
  return { jobs: jobs.map((j) => map.get(j.id) ?? j), configured };
}

export function DataWorkspace() {
  const [activeTab, setActiveTab] = useState<"add" | "corpus" | "etl">("add");
  const [scrapeHasError, setScrapeHasError] = useState(false);
  const prevJobsRef = useRef<CrawlJob[]>([]);

  const jobsQuery = useSWR("/api/jobs", fetchJobsWithSync, {
    refreshInterval: (data) =>
      data?.jobs.some((j) => j.status === "running" || j.status === "queued")
        ? 4000
        : 0,
  });
  const jobs = jobsQuery.data?.jobs ?? [];
  const configured = jobsQuery.data?.configured ?? true;
  const hasActive = jobs.some(
    (j) => j.status === "running" || j.status === "queued",
  );

  useEffect(() => {
    const prevJobs = prevJobsRef.current;
    if (prevJobs.length > 0 && jobs.length > 0) {
      const justCompleted = jobs.filter(
        (j) =>
          j.status === "completed" &&
          prevJobs.some(
            (pj) =>
              pj.id === j.id &&
              (pj.status === "running" || pj.status === "queued"),
          ),
      );

      if (justCompleted.length > 0) {
        toast.success(
          "Indexing these corpus just added successfully completed.",
        );
      }
    }
    prevJobsRef.current = jobs;
  }, [jobs]);

  const docsQuery = useSWR<DocsResponse>("/api/documents", fetcher, {
    refreshInterval: hasActive ? 5000 : 0,
  });
  const documents = docsQuery.data?.documents ?? [];
  const stats = docsQuery.data?.stats;

  const { mutate: mutateGlobal } = useSWRConfig();

  const refreshAll = () => {
    jobsQuery.mutate();
    docsQuery.mutate();
    mutateGlobal("/api/index");
  };

  const handleDataAdded = () => {
    refreshAll();
    setActiveTab("etl");
  };

  return (
    <div className="px-6  md:px-8">
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as "add" | "corpus" | "etl")}
        className="w-full"
      >
        <TabsList className="mb-3 flex w-full h-10 justify-start rounded-none border-b border-border bg-transparent p-0! ">
          <TabsTrigger
            value="add"
            className="h-full flex-none rounded-none border-b-2 border-transparent bg-transparent! px-4 font-medium text-muted-foreground shadow-none! transition-none data-active:border-transparent data-[state=active]:border-transparent data-active:border-b-foreground data-[state=active]:border-b-foreground data-active:text-foreground data-[state=active]:text-foreground hover:text-foreground"
          >
            {/* <Plus className="size-4 mr-2" /> */}
            Add Data
          </TabsTrigger>
          <TabsTrigger
            value="corpus"
            className="h-full flex-none rounded-none border-b-2 border-transparent bg-transparent! px-4 font-medium text-muted-foreground shadow-none! transition-none data-active:border-transparent data-[state=active]:border-transparent data-active:border-b-foreground data-[state=active]:border-b-foreground data-active:text-foreground data-[state=active]:text-foreground hover:text-foreground"
          >
            Corpus
          </TabsTrigger>
          <TabsTrigger
            value="etl"
            className="h-full flex-none rounded-none border-b-2 border-transparent bg-transparent! px-4 font-medium text-muted-foreground shadow-none! transition-none data-active:border-transparent data-[state=active]:border-transparent data-active:border-b-foreground data-[state=active]:border-b-foreground data-active:text-foreground data-[state=active]:text-foreground hover:text-foreground"
          >
            ETL Jobs
            {hasActive && (
              <span className="ml-2 flex items-center gap-1.5 text-xs text-green-600">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-600 opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-green-600" />
                </span>
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent
          value="add"
          className="m-0 focus-visible:outline-none focus-visible:ring-0 p-0"
        >
          <Card className="bg-transparent border-none! ring-0 p-0 m-0! pl-0! shadow-none">
            <CardContent className="border-none shadow-none  m-0! p-0.5">
              <Tabs defaultValue="scrape" className="flex flex-col w-full">
                <div className="shrink-0 mb-6">
                  <TabsList className="inline-flex h-10! items-center justify-center rounded-lg bg-muted/30! border p-1 text-muted-foreground">
                    <TabsTrigger
                      value="scrape"
                      className="inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-all focus-visible:outline-none data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm hover:text-foreground"
                    >
                      <Globe className="size-4 mr-2" />
                      Web scrape
                    </TabsTrigger>
                    <TabsTrigger
                      value="paste"
                      className="inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-all focus-visible:outline-none data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm hover:text-foreground"
                    >
                      <ClipboardPaste className="size-4 mr-2" />
                      Paste text
                    </TabsTrigger>
                    <TabsTrigger
                      value="upload"
                      className="inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-all focus-visible:outline-none data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm hover:text-foreground"
                    >
                      <FileUp className="size-4 mr-2" />
                      Upload files
                    </TabsTrigger>
                  </TabsList>
                </div>

                <div className="flex-1 w-full">
                  <TabsContent
                    value="scrape"
                    className="m-0 h-full focus-visible:outline-none focus-visible:ring-0"
                  >
                    <div className="mb-4">
                      <FirecrawlNotice
                        cloudConfigured={configured}
                        onChange={refreshAll}
                        onErrorChange={setScrapeHasError}
                      />
                    </div>
                    <ScrapePanel
                      disabled={false}
                      onStarted={handleDataAdded}
                    />
                  </TabsContent>
                  <TabsContent
                    value="paste"
                    className="m-0 h-full focus-visible:outline-none focus-visible:ring-0"
                  >
                    <PastePanel onAdded={handleDataAdded} />
                  </TabsContent>
                  <TabsContent
                    value="upload"
                    className="m-0 h-full focus-visible:outline-none focus-visible:ring-0"
                  >
                    <UploadPanel onAdded={handleDataAdded} />
                  </TabsContent>
                </div>
              </Tabs>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent
          value="corpus"
          className="m-0 focus-visible:outline-none focus-visible:ring-0"
        >
          <Card>
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
        </TabsContent>

        <TabsContent
          value="etl"
          className="m-0 focus-visible:outline-none focus-visible:ring-0"
        >
          <Card>
            <CardHeader className="flex-row items-center justify-between shrink-0">
              <CardTitle className="text-base">ETL jobs</CardTitle>
            </CardHeader>
            <CardContent>
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
        </TabsContent>
      </Tabs>
    </div>
  );
}
