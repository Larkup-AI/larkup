'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, usePathname } from 'next/navigation';
import useSWR, { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import type { CrawlJob, SourceDocument, IndexRun } from '@larkup/core/types';
import { Globe, FileUp, Type, Image, Plug, Briefcase, ChevronDown } from 'lucide-react';
import { ScrapePanel } from '@/components/data/scrape-panel';
import { PastePanel } from '@/components/data/paste-panel';
import { UploadPanel } from '@/components/data/upload-panel';
import { MediaPanel } from '@/components/data/media-panel';
import { IntegrationsPanel } from '@/components/data/integrations-panel';
import { JobsPanel } from '@/components/data/jobs-panel';
import { CorpusPanel } from '@/components/data/corpus-panel';
import { FirecrawlNotice } from '@/components/data/firecrawl-notice';
import { IndexWorkspace } from '@/components/index/index-workspace';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

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
  const active = jobs.filter((j) => j.status === 'running' || j.status === 'queued');
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

// ---------- Tab definitions ----------

const TOP_TABS = [
  { id: 'add', label: 'Add Data' },
  { id: 'corpus', label: 'Knowledge Base' },
] as const;

const SUB_TABS = [
  { id: 'website', label: 'Website', icon: Globe },
  { id: 'files', label: 'Files', icon: FileUp },
  { id: 'text', label: 'Text', icon: Type },
  { id: 'media', label: 'Media', icon: Image },
  { id: 'notion', label: 'Integrations', icon: Plug },
] as const;

type TopTabId = (typeof TOP_TABS)[number]['id'];
type SubTabId = (typeof SUB_TABS)[number]['id'];

export function DataWorkspace() {
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const getInitialTab = (): TopTabId => {
    const tab = searchParams.get('tab') as TopTabId;
    if (tab && TOP_TABS.some((t) => t.id === tab)) return tab;
    return 'add';
  };

  const getInitialSubTab = (): SubTabId => {
    const subtab = searchParams.get('subtab') as SubTabId;
    if (subtab && SUB_TABS.some((t) => t.id === subtab)) return subtab;
    return 'website';
  };

  const [activeTab, setActiveTabState] = useState<TopTabId>(getInitialTab());
  const [activeSubTab, setActiveSubTabState] = useState<SubTabId>(getInitialSubTab());

  useEffect(() => {
    const tab = searchParams.get('tab') as TopTabId;
    if (tab && tab !== activeTab && TOP_TABS.some((t) => t.id === tab)) {
      setActiveTabState(tab);
    }
    const subtab = searchParams.get('subtab') as SubTabId;
    if (subtab && subtab !== activeSubTab && SUB_TABS.some((t) => t.id === subtab)) {
      setActiveSubTabState(subtab);
    }
  }, [searchParams, activeTab, activeSubTab]);

  const setActiveTab = useCallback(
    (tab: TopTabId) => {
      setActiveTabState(tab);
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', tab);
      window.history.replaceState(null, '', `${pathname}?${params.toString()}`);
    },
    [pathname, searchParams],
  );

  const setActiveSubTab = (subtab: SubTabId) => {
    setActiveSubTabState(subtab);
    const params = new URLSearchParams(searchParams.toString());
    params.set('subtab', subtab);
    window.history.replaceState(null, '', `${pathname}?${params.toString()}`);
  };
  const [showJobsDrawer, setShowJobsDrawer] = useState(false);
  const [indexDialogOpen, setIndexDialogOpen] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const prevJobsRef = useRef<CrawlJob[]>([]);

  const jobsQuery = useSWR('/api/jobs', fetchJobsWithSync, {
    refreshInterval: (data) =>
      data?.jobs.some((j) => j.status === 'running' || j.status === 'queued') ? 4000 : 0,
  });
  const jobs = jobsQuery.data?.jobs ?? [];
  const configured = jobsQuery.data?.configured ?? true;
  const hasActive = jobs.some((j) => j.status === 'running' || j.status === 'queued');

  const docsQuery = useSWR<DocsResponse>('/api/documents', fetcher, {
    refreshInterval: hasActive ? 5000 : 0,
  });
  const { mutate: mutateDocuments } = docsQuery;
  const documents = docsQuery.data?.documents ?? [];

  const indexQuery = useSWR<{
    unindexedCount: number;
    running: boolean;
    run: IndexRun | null;
  }>('/api/index', fetcher, {
    refreshInterval: (d) => (d?.running ? 2000 : 0),
  });
  const indexRunning = indexQuery.data?.running ?? false;
  const { mutate: mutateIndex } = indexQuery;

  const prevIndexRunning = useRef(indexRunning);
  useEffect(() => {
    if (prevIndexRunning.current && !indexRunning) {
      docsQuery.mutate();
    }
    prevIndexRunning.current = indexRunning;
  }, [indexRunning, docsQuery]);

  const { mutate: mutateGlobal } = useSWRConfig();

  const refreshAll = () => {
    jobsQuery.mutate();
    docsQuery.mutate();
    indexQuery.mutate();
    mutateGlobal('/api/index');
  };

  const startAutomaticIndex = useCallback(async () => {
    try {
      const res = await fetch('/api/index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ incremental: indexQuery.data?.run?.status === 'completed' }),
      });
      const body = await res.json();
      if (res.status === 409) return;
      if (!res.ok) {
        toast.error(body.error || 'Your data was added, but indexing could not start.');
        return;
      }
      toast.success('Making your data searchable', {
        description: 'This continues in the background. You can safely leave this page.',
        duration: 7_000,
      });
      setIndexDialogOpen(true);
      void indexQuery.mutate();
    } catch {
      toast.error('Your data was added, but indexing could not start.');
    }
  }, [indexQuery]);

  useEffect(() => {
    const prevJobs = prevJobsRef.current;
    if (prevJobs.length > 0 && jobs.length > 0) {
      const justCompleted = jobs.filter(
        (j) =>
          j.status === 'completed' &&
          prevJobs.some(
            (pj) => pj.id === j.id && (pj.status === 'running' || pj.status === 'queued'),
          ),
      );

      if (justCompleted.length > 0) {
        toast.success('Scraping completed. Making the new pages searchable…');
        void mutateDocuments();
        setTimeout(() => void mutateDocuments(), 2500);
        void startAutomaticIndex();
      }
    }
    prevJobsRef.current = jobs;
  }, [jobs, mutateDocuments, startAutomaticIndex]);

  const handleDataAdded = () => {
    refreshAll();
    void startAutomaticIndex();
  };

  const handleScrapeStarted = useCallback(
    (job: CrawlJob) => {
      // Make the queued job visible immediately. Revalidation then advances it
      // through the normal status endpoint without asking the user to reload.
      void jobsQuery.mutate(
        (current) => ({
          jobs: [job, ...(current?.jobs ?? []).filter((existing) => existing.id !== job.id)],
          configured: current?.configured ?? true,
        }),
        { revalidate: true },
      );
      setShowJobsDrawer(true);
    },
    [jobsQuery],
  );

  const handleMediaIndexed = useCallback(() => {
    // Refresh the corpus without pulling the user away from the live media
    // workspace; they can inspect another job or open the Knowledge Base when
    // they are ready.
    void mutateDocuments();
    void mutateIndex();
    toast.success('Media indexed and added to your Knowledge Base.');
  }, [mutateDocuments, mutateIndex]);

  return (
    <div className="px-6 md:px-8">
      {/* ─── Top-level tabs + action buttons ─── */}
      <div className="flex w-full items-center justify-between mb-6">
        <div className="flex items-center rounded-sm bg-white/90 p-0.5 border h-11">
          {TOP_TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'relative flex cursor-pointer items-center justify-center px-4 h-9 text-sm font-medium transition-colors outline-none ',
                  isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {isActive && (
                  <motion.div
                    layoutId="data-tabs-indicator"
                    className="absolute inset-0 rounded-sm bg-background  border border-border/50"
                    initial={false}
                    transition={{
                      type: 'spring',
                      stiffness: 500,
                      damping: 35,
                    }}
                  />
                )}
                <span className="relative z-10 flex items-center">
                  {tab.label}
                  {tab.id === 'add' && hasActive && (
                    <span className="ml-2 flex items-center gap-1.5 text-xs text-emerald-600">
                      <span className="relative flex size-2">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                        <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
                      </span>
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          {/* Floating jobs indicator */}
          {jobs.length > 0 && (
            <button
              type="button"
              onClick={() => setShowJobsDrawer(!showJobsDrawer)}
              className={cn(
                'flex items-center gap-2 rounded-lg border h-10 px-4 text-sm font-medium transition-colors',
                hasActive
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                  : 'border-border bg-card text-muted-foreground hover:bg-muted/50 hover:text-foreground',
              )}
            >
              <Briefcase className="size-4" />
              {hasActive ? (
                <>
                  <span className="relative flex size-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                    <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
                  </span>
                  {jobs.filter((j) => j.status === 'running' || j.status === 'queued').length}{' '}
                  active
                </>
              ) : (
                <>
                  {jobs.length} job{jobs.length !== 1 ? 's' : ''}
                </>
              )}
              <ChevronDown
                className={cn(
                  'ml-1 size-4 transition-transform duration-200',
                  showJobsDrawer && 'rotate-180',
                )}
              />
            </button>
          )}

          {/* Indexing begins automatically after data is added. */}
          <Dialog open={indexDialogOpen} onOpenChange={setIndexDialogOpen}>
            <DialogContent className="max-w-lg overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Making your data searchable</DialogTitle>
                <DialogDescription>
                  This runs safely in the background. You can close this and come back anytime.
                </DialogDescription>
              </DialogHeader>
              <IndexWorkspace
                automatic
                onDone={() => {
                  indexQuery.mutate();
                  setResetKey((k) => k + 1);
                }}
                onClose={() => setIndexDialogOpen(false)}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* ─── Jobs drawer (minimal, collapsible) ─── */}
      {showJobsDrawer && jobs.length > 0 && (
        <div className="mb-6 animate-in slide-in-from-top-2 fade-in duration-200">
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground">Scraping Jobs</h3>
              <button
                type="button"
                onClick={() => setShowJobsDrawer(false)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Hide
              </button>
            </div>
            <JobsPanel jobs={jobs} onChanged={refreshAll} />
          </div>
        </div>
      )}

      <div className="mt-2">
        {activeTab === 'add' && (
          <div className="w-full">
            {/* ─── Line-style sub-tabs ─── */}
            <div className="border-b border-border mb-6">
              <div className="flex items-center gap-1 -mb-px">
                {SUB_TABS.map((tab) => {
                  const isActive = activeSubTab === tab.id;
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveSubTab(tab.id)}
                      className={cn(
                        'relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors outline-none',
                        isActive
                          ? 'text-foreground'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      <Icon className="size-4" />
                      {tab.label}
                      {isActive && (
                        <motion.div
                          layoutId="add-data-sub-tab-indicator"
                          className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full"
                          initial={false}
                          transition={{
                            type: 'spring',
                            stiffness: 500,
                            damping: 35,
                          }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ─── Tab content ─── */}
            <div className="relative" key={resetKey}>
              {activeSubTab === 'website' && (
                <div className="w-full flex flex-col gap-8 animate-in fade-in duration-200">
                  <div>
                    <ScrapePanel
                      onStarted={handleScrapeStarted}
                      crawlerControl={<FirecrawlNotice cloudConfigured={configured} />}
                    />
                  </div>
                  {/* {jobs.length > 0 && !showJobsDrawer && (
                    <div className="pt-8 border-t border-border">
                      <h3 className="text-lg font-semibold tracking-tight mb-4">
                        Recent Scrape Jobs
                      </h3>
                      <JobsPanel jobs={jobs} onChanged={refreshAll} />
                    </div>
                  )} */}
                </div>
              )}

              {activeSubTab === 'files' && (
                <div className="animate-in fade-in duration-200">
                  <UploadPanel onAdded={handleDataAdded} />
                </div>
              )}

              {activeSubTab === 'text' && (
                <div className=" animate-in fade-in duration-200">
                  <PastePanel onAdded={handleDataAdded} />
                </div>
              )}

              {activeSubTab === 'media' && (
                <div className="animate-in fade-in duration-200">
                  <MediaPanel onAdded={refreshAll} onIndexed={handleMediaIndexed} />
                </div>
              )}

              {activeSubTab === 'notion' && (
                <div className="animate-in fade-in duration-200">
                  <IntegrationsPanel onAdded={handleDataAdded} />
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'corpus' && (
          <div className="animate-in fade-in duration-300">
            <CorpusPanel documents={documents} onChanged={refreshAll} isIndexing={indexRunning} />
          </div>
        )}
      </div>
    </div>
  );
}
