'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, usePathname } from 'next/navigation';
import Link from 'next/link';
import useSWR, { useSWRConfig } from 'swr';
import { toast } from 'sonner';
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
  Loader2,
  Plus,
  KeyRound,
} from 'lucide-react';
import { ScrapePanel } from '@/components/data/scrape-panel';
import { PastePanel } from '@/components/data/paste-panel';
import { UploadPanel } from '@/components/data/upload-panel';
import { MediaPanel } from '@/components/data/media-panel';
import { IntegrationsPanel } from '@/components/data/integrations-panel';
import { JobsPanel } from '@/components/data/jobs-panel';
import { CorpusPanel } from '@/components/data/corpus-panel';
import { IndexWorkspace } from '@/components/index/index-workspace';
import type { DataPrimaryAction } from '@/components/data/data-primary-action';
import { Button } from '@/components/ui/button';
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

const SUB_TABS = [
  { id: 'files', label: 'Files', icon: FileUp },
  { id: 'text', label: 'Text', icon: Type },
  { id: 'website', label: 'Website', icon: Globe },
  { id: 'media', label: 'Media', icon: Image },
  { id: 'notion', label: 'Integrations', icon: Plug },
] as const;

type TopTabId = 'add' | 'corpus';
type SubTabId = (typeof SUB_TABS)[number]['id'];

const SUB_TAB_INTRO: Record<SubTabId, { title: string; description: string }> = {
  files: {
    title: 'Add Files',
    description: 'Upload PDFs, documents, spreadsheets, CSVs, JSON files, and more.',
  },
  text: {
    title: 'Add Text',
    description: 'Paste notes, documentation, transcripts, or any text you want to search.',
  },
  website: {
    title: 'Add Websites',
    description: 'Add a URL or discover and crawl websites for your knowledge base.',
  },
  media: {
    title: 'Add Media',
    description: 'Upload images, audio, and video, or add media from a URL.',
  },
  notion: {
    title: 'Add Integrations',
    description: 'Connect your tools and import the data your team already uses.',
  },
};

export function DataWorkspace({ view }: { view?: TopTabId } = {}) {
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const getInitialTab = (): TopTabId => {
    if (view) return view;
    return 'add';
  };

  const getInitialSubTab = (): SubTabId => {
    const subtab = searchParams.get('subtab') as SubTabId;
    if (subtab && SUB_TABS.some((t) => t.id === subtab)) return subtab;
    return 'files';
  };

  const [activeTab, setActiveTabState] = useState<TopTabId>(getInitialTab());
  const [activeSubTab, setActiveSubTabState] = useState<SubTabId>(getInitialSubTab());

  useEffect(() => {
    if (view) {
      setActiveTabState(view);
      return;
    }
    const subtab = searchParams.get('subtab') as SubTabId;
    if (subtab && subtab !== activeSubTab && SUB_TABS.some((t) => t.id === subtab)) {
      setActiveSubTabState(subtab);
    }
  }, [searchParams, activeTab, activeSubTab, view]);

  const setActiveSubTab = (subtab: SubTabId) => {
    // The outgoing panel owns the shared primary action. Clear it before changing
    // tabs so the incoming panel can register its action after it mounts.
    // Clearing it in an effect races with that registration on initial render.
    setPrimaryAction(null);
    setActiveSubTabState(subtab);
    const params = new URLSearchParams(searchParams.toString());
    params.set('subtab', subtab);
    window.history.replaceState(null, '', `${pathname}?${params.toString()}`);
  };
  const [showJobsDrawer, setShowJobsDrawer] = useState(false);
  const [primaryAction, setPrimaryAction] = useState<DataPrimaryAction | null>(null);
  const registerPrimaryAction = useCallback((action: DataPrimaryAction | null) => {
    setPrimaryAction(action);
  }, []);
  const [indexDialogOpen, setIndexDialogOpen] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const prevJobsRef = useRef<CrawlJob[]>([]);

  const jobsQuery = useSWR('/api/jobs', fetchJobsWithSync, {
    refreshInterval: (data) =>
      data?.jobs.some((j) => j.status === 'running' || j.status === 'queued') ? 4000 : 0,
  });
  const jobs = jobsQuery.data?.jobs ?? [];
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
    blockers: string[];
  }>('/api/index', fetcher, {
    refreshInterval: (d) => (d?.running ? 2000 : 0),
  });
  const indexRunning = indexQuery.data?.running ?? false;
  const dataAddBlocked = indexQuery.data?.blockers?.includes('MISSING_EMBEDDING_API_KEY') ?? false;
  const { mutate: mutateIndex } = indexQuery;

  useEffect(() => {
    if (dataAddBlocked) setPrimaryAction(null);
  }, [dataAddBlocked]);

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
        body: JSON.stringify({ incremental: Boolean(indexQuery.data?.run) }),
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

  const activeSubTabIntro = SUB_TAB_INTRO[activeSubTab];

  return (
    <div className="px-6 md:px-8">
      {view === 'add' && (
        <>
          <div className="mb-2 flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-foreground">
                {activeSubTabIntro.title}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">{activeSubTabIntro.description}</p>
            </div>
            {jobs.length > 0 && (
              <button
                type="button"
                onClick={() => setShowJobsDrawer(!showJobsDrawer)}
                className={cn(
                  'flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors',
                  hasActive
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                    : 'border-border bg-card text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                )}
              >
                <Briefcase className="size-4" />
                {hasActive
                  ? `${
                      jobs.filter((j) => j.status === 'running' || j.status === 'queued').length
                    } active`
                  : `${jobs.length} job${jobs.length === 1 ? '' : 's'}`}
                <ChevronDown
                  className={cn(
                    'size-4 transition-transform duration-200',
                    showJobsDrawer && 'rotate-180',
                  )}
                />
              </button>
            )}
          </div>
          <div className="mb-4 pb-1 mt-9 flex items-center justify-between border-b border-border">
            <div
              className={cn('-mb-2 flex items-center gap-1', activeSubTab === 'notion' && 'pb-1')}
            >
              {SUB_TABS.map((tab) => {
                const isActive = activeSubTab === tab.id;
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveSubTab(tab.id)}
                    className={cn(
                      'relative flex items-center gap-2 px-4 py-2.5  text-sm font-medium transition-colors outline-none',
                      isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <Icon className="size-4" />
                    {tab.label}
                    {isActive && (
                      <span
                        aria-hidden="true"
                        className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-primary motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-left-2 motion-safe:duration-200"
                      />
                    )}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2 pb-1">
              {primaryAction && (
                <Button
                  size="default"
                  onClick={primaryAction.onClick}
                  disabled={dataAddBlocked || primaryAction.disabled || primaryAction.loading}
                >
                  {primaryAction.loading ? (
                    <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                  ) : (
                    <Plus className="mr-1.5 size-3.5" />
                  )}
                  {primaryAction.label}
                </Button>
              )}
            </div>
          </div>
        </>
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

      <div>
        {activeTab === 'add' && (
          <div className="w-full ">
            {/* ─── Tab content ─── */}
            <div className="relative" key={resetKey}>
              {dataAddBlocked ? (
                <div className="mx-auto flex min-h-72 max-w-xl mt-5 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 px-6 text-center">
                  <div className="mb-4 rounded-full bg-primary/10 p-3 text-primary">
                    <KeyRound className="size-5" />
                  </div>
                  <h2 className="text-base font-semibold">Set an embedding API key first</h2>
                  <p className="mt-2 max-w-md text-sm text-muted-foreground">
                    Data is kept out of the Knowledge Base until it can be indexed. Configure an
                    embedding provider and API key, then return here to add data.
                  </p>
                  <Link
                    href="/settings?section=models"
                    className="mt-5 inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    Open AI model settings
                  </Link>
                </div>
              ) : (
                <>
                  {activeSubTab === 'website' && (
                    <div className="w-full flex flex-col gap-8 animate-in fade-in duration-200">
                      <div>
                        <ScrapePanel
                          onStarted={handleScrapeStarted}
                          onActionChange={registerPrimaryAction}
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
                      <UploadPanel
                        onAdded={handleDataAdded}
                        onActionChange={registerPrimaryAction}
                      />
                    </div>
                  )}

                  {activeSubTab === 'text' && (
                    <div className=" animate-in fade-in duration-200">
                      <PastePanel
                        onAdded={handleDataAdded}
                        onActionChange={registerPrimaryAction}
                      />
                    </div>
                  )}

                  {activeSubTab === 'media' && (
                    <div className="animate-in fade-in duration-200">
                      <MediaPanel
                        onAdded={refreshAll}
                        onIndexed={handleMediaIndexed}
                        onActionChange={registerPrimaryAction}
                      />
                    </div>
                  )}

                  {activeSubTab === 'notion' && (
                    <div className="animate-in fade-in duration-200">
                      <IntegrationsPanel onAdded={handleDataAdded} />
                    </div>
                  )}
                </>
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
