'use client';

import { useCallback, useState } from 'react';
import type { IndexRun } from '@larkup/core/types';
import { BriefcaseBusiness, ListTodo, Loader2, TriangleAlert } from 'lucide-react';
import useSWR from 'swr';
import { useProject } from '@/components/projects/project-provider';
import { JobsPanel } from '@/components/data/jobs-panel';
import {
  isActiveMediaIndexing,
  MediaIndexingJobsPanel,
  type MediaIndexingResponse,
} from '@/components/data/media-indexing-jobs-panel';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { fetchJobsWithSync } from '@/lib/jobs-client';
import { cn } from '@/lib/utils';

const fetcher = async <T,>(url: string): Promise<T> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Could not load job progress.');
  return response.json() as Promise<T>;
};

interface IndexStatus {
  unindexedCount: number;
  running: boolean;
  run: IndexRun | null;
  blockers: string[];
}

export function JobsTrackingButton() {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<'running' | 'all'>('running');
  const { activeProject } = useProject();
  const serverId = activeProject?.id;

  const {
    data: jobsData,
    error: jobsError,
    mutate: mutateJobs,
  } = useSWR('/api/jobs', fetchJobsWithSync, {
    refreshInterval: (data) =>
      data?.jobs.some((job) => job.status === 'running' || job.status === 'queued') ? 4_000 : 0,
    revalidateOnFocus: true,
  });
  const {
    data: indexData,
    error: indexError,
    mutate: mutateIndex,
  } = useSWR<IndexStatus>('/api/index', fetcher, {
    refreshInterval: (data) => (data?.running ? 2_000 : 0),
    revalidateOnFocus: true,
  });
  const mediaUrl = `/api/media?type=all${serverId ? `&serverId=${encodeURIComponent(serverId)}` : ''}`;
  const {
    data: mediaData,
    error: mediaError,
    mutate: mutateMedia,
  } = useSWR<MediaIndexingResponse>(mediaUrl, fetcher, {
    refreshInterval: (data) => (data?.assets.some(isActiveMediaIndexing) ? 2_000 : 0),
    revalidateOnFocus: true,
  });

  const jobs = jobsData?.jobs ?? [];
  const activeCrawlJobs = jobs.filter((job) => job.status === 'running' || job.status === 'queued');
  const activeMediaAssets = (mediaData?.assets ?? []).filter(isActiveMediaIndexing);
  const indexRunning = indexData?.running ?? false;
  const activeJobCount = activeCrawlJobs.length + activeMediaAssets.length + (indexRunning ? 1 : 0);
  const hasActiveJobs = activeJobCount > 0;
  const hasAnyJobs = jobs.length > 0 || activeMediaAssets.length > 0 || indexRunning;
  const loadError = jobsError || indexError || mediaError;
  const visibleJobs = filter === 'running' ? activeCrawlJobs : jobs;

  const refreshAll = useCallback(() => {
    void Promise.all([mutateJobs(), mutateIndex(), mutateMedia()]);
  }, [mutateIndex, mutateJobs, mutateMedia]);

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) refreshAll();
      }}
    >
      <TooltipProvider delay={50}>
        <Tooltip>
          <TooltipTrigger
            render={
              <SheetTrigger
                render={
                  <button
                    type="button"
                    aria-label={
                      hasActiveJobs ? `Jobs tracking, ${activeJobCount} active` : 'Jobs tracking'
                    }
                    className={cn(
                      'relative flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground',
                      hasActiveJobs &&
                        'bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 hover:text-emerald-700 dark:text-emerald-400',
                    )}
                  >
                    <ListTodo className="size-4" />
                    {hasActiveJobs && (
                      <span
                        aria-hidden="true"
                        className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-emerald-500 px-0.5 text-[9px] font-semibold leading-none text-white ring-2 ring-background motion-safe:animate-pulse"
                      >
                        {activeJobCount > 9 ? '9+' : activeJobCount}
                      </span>
                    )}
                  </button>
                }
              />
            }
          />
          <TooltipContent>{hasActiveJobs ? 'Active jobs' : 'Jobs'}</TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <SheetContent side="right" className="w-[calc(100vw-1rem)]! max-w-2xl! gap-0 p-0 sm:w-2xl!">
        <SheetHeader className="border-b border-border px-5 py-4 pr-14">
          <div className="flex items-center gap-2.5">
            <div
              className={cn(
                'flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground',
                hasActiveJobs && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
              )}
            >
              <ListTodo className="size-4" />
            </div>
            <div className="min-w-0">
              <SheetTitle className="text-sm font-semibold">Jobs</SheetTitle>
              <SheetDescription className="text-xs">
                {hasActiveJobs
                  ? `${activeJobCount} background ${activeJobCount === 1 ? 'job' : 'jobs'} active`
                  : 'Track indexing and website jobs'}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {loadError && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-xs text-amber-800 dark:text-amber-300">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              Some job progress could not be refreshed. The available results are shown below.
            </div>
          )}

          {!hasAnyJobs ? (
            <div className="flex min-h-64 flex-col items-center justify-center text-center">
              <div className="mb-3 flex size-10 items-center justify-center rounded-xl border border-border bg-muted/40 text-muted-foreground">
                <BriefcaseBusiness className="size-4.5" />
              </div>
              <p className="text-sm font-medium text-foreground">No jobs yet</p>
              <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
                File indexing, media processing, and website jobs will appear here while they run.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              <MediaIndexingJobsPanel assets={activeMediaAssets} />

              {indexRunning && (
                <div className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5">
                  <Loader2 className="size-4 shrink-0 animate-spin text-emerald-600" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground">Indexing files</p>
                    <p className="text-[11px] text-muted-foreground">
                      Running in the background — new files will join the queue.
                    </p>
                  </div>
                </div>
              )}

              {jobs.length > 0 && (
                <section
                  className={cn(
                    (activeMediaAssets.length > 0 || indexRunning) && 'border-t border-border pt-4',
                  )}
                >
                  <div className="mb-3 flex items-center gap-2">
                    {[
                      { id: 'running', label: 'Running' },
                      { id: 'all', label: 'All jobs' },
                    ].map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        aria-pressed={filter === tab.id}
                        onClick={() => setFilter(tab.id as 'running' | 'all')}
                        className={cn(
                          'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                          filter === tab.id
                            ? 'bg-muted text-foreground'
                            : 'border border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                        )}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                  <JobsPanel jobs={visibleJobs} onChanged={refreshAll} />
                </section>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
