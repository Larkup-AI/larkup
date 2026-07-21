'use client';

import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import useSWR, { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import type { CrawlJob, SourceDocument, IndexRun } from '@larkup/core/types';
import {
  Globe,
  FileUp,
  Type,
  Image,
  Plug,
  Briefcase,
  ChevronDown,
  Zap,
  RotateCcw,
} from 'lucide-react';
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
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

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
  const router = useRouter();
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

  const setActiveTab = (tab: TopTabId) => {
    setActiveTabState(tab);
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tab);
    window.history.replaceState(null, '', `${pathname}?${params.toString()}`);
  };

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
        toast.success('Indexing completed.');
      }
    }
    prevJobsRef.current = jobs;
  }, [jobs]);

  const docsQuery = useSWR<DocsResponse>('/api/documents', fetcher, {
    refreshInterval: hasActive ? 5000 : 0,
  });
  const documents = docsQuery.data?.documents ?? [];
  const stats = docsQuery.data?.stats;
  const docCount = stats?.docCount ?? 0;

  const indexQuery = useSWR<{
    unindexedCount: number;
    running: boolean;
    run: IndexRun | null;
  }>('/api/index', fetcher, {
    refreshInterval: (d) => (d?.running ? 2000 : 0),
  });
  const unindexedCount = indexQuery.data?.unindexedCount ?? 0;
  const indexRunning = indexQuery.data?.running ?? false;
  const hasCompletedIndex = indexQuery.data?.run?.status === 'completed';

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

  const handleDataAdded = () => {
    refreshAll();
    setActiveTab('corpus');
  };

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

          {hasCompletedIndex && !indexRunning && (
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button variant="outline" className="h-10 bg-white px-4 text-sm gap-1.5">
                    <RotateCcw className="size-3.5" />
                    Re-Index
                  </Button>
                }
              />
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Are you sure you want to re-index data?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will rebuild the entire index from scratch. All documents will be
                    re-processed.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      fetch('/api/index', {
                        method: 'POST',
                        body: JSON.stringify({ incremental: false }),
                        headers: { 'Content-Type': 'application/json' },
                      }).then(() => {
                        toast.success('Indexing started.');
                        setIndexDialogOpen(true);
                        indexQuery.mutate();
                      });
                    }}
                  >
                    Continue
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}

          <Dialog open={indexDialogOpen} onOpenChange={setIndexDialogOpen}>
            <DialogTrigger
              render={
                <Button
                  variant={indexRunning ? 'success' : 'default'}
                  disabled={(docCount === 0 || unindexedCount === 0) && !indexRunning}
                  className="h-10 rounded-md px-4 gap-1.5 text-sm"
                >
                  {indexRunning ? (
                    <>
                      <span className="relative flex size-2">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                        <span className="relative inline-flex size-2 rounded-full bg-white" />
                      </span>
                      Indexing…
                    </>
                  ) : (
                    <>
                      <Zap className="size-3.5" />
                      {unindexedCount > 0 ? `Start Indexing (${unindexedCount})` : 'Start Indexing'}
                    </>
                  )}
                </Button>
              }
            />
            <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto ">
              <DialogHeader>
                <DialogTitle>Build Index</DialogTitle>
                <DialogDescription>
                  Embed your documents into a vector index for semantic search.
                </DialogDescription>
              </DialogHeader>
              <IndexWorkspace
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
                      onStarted={() => {
                        handleDataAdded();
                        setShowJobsDrawer(true);
                      }}
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
                  <MediaPanel onAdded={handleDataAdded} />
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
