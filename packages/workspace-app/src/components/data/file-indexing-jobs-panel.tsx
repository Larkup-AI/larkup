'use client';

import { Loader2, TriangleAlert } from 'lucide-react';
import type { IndexRun } from '@larkup/core/types';

export interface FileIndexSource {
  id: string;
  name: string;
  status: string;
  jobStatus?: string | null;
  message?: string;
  processedChunks: number;
  totalChunks: number;
  error?: string | null;
  updatedAt?: string;
}

export interface FileIndexStatus {
  unindexedCount: number;
  running: boolean;
  run: IndexRun | null;
  blockers: string[];
  sources?: FileIndexSource[];
}

function failureMessage(error?: string | null): string {
  if (error === 'BACKGROUND_JOB_INTERRUPTED')
    return 'The indexing worker stopped. Retry indexing from Data Sources.';
  if (error === 'BACKGROUND_JOB_FAILED')
    return 'Indexing failed. Retry from Data Sources or contact support if it happens again.';
  return error || 'Indexing failed. Retry from Data Sources.';
}

export function FileIndexingJobsPanel({ status }: { status?: FileIndexStatus }) {
  if (!status) return null;
  const sources = status.sources ?? [];
  const visible = sources.filter((source) =>
    ['queued', 'processing', 'failed'].includes(source.status),
  );
  if (!status.running && visible.length === 0) return null;

  return (
    <section aria-label="File indexing progress" className="space-y-2">
      {visible.length > 0 ? (
        visible.map((source) => {
          const failed = source.status === 'failed' || source.jobStatus === 'failed';
          const queued = source.status === 'queued';
          const percent =
            source.totalChunks > 0
              ? Math.round((source.processedChunks / source.totalChunks) * 100)
              : null;
          const ageMinutes = source.updatedAt
            ? Math.floor((Date.now() - new Date(source.updatedAt).getTime()) / 60_000)
            : 0;
          return (
            <div
              key={source.id}
              className="rounded-lg border border-border bg-background px-3 py-2.5"
            >
              <div className="flex items-start gap-3">
                {failed ? (
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
                ) : (
                  <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-emerald-600" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2 text-xs font-medium">
                    <span className="truncate" title={source.name}>
                      {source.name}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {failed
                        ? 'Failed'
                        : queued
                          ? 'Queued'
                          : percent === null
                            ? 'Processing'
                            : `${percent}%`}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {failed
                      ? failureMessage(source.error)
                      : queued
                        ? ageMinutes >= 10
                          ? `Waiting for an indexing worker for ${ageMinutes} minutes. Contact support if this continues.`
                          : `Waiting for an indexing worker${ageMinutes >= 2 ? ` for ${ageMinutes} minutes` : ''}`
                        : source.message || 'Preparing the search index'}
                  </p>
                  {!failed && !queued && ageMinutes >= 10 && (
                    <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                      No new progress for {ageMinutes} minutes
                    </p>
                  )}
                  {!failed && !queued && percent !== null && (
                    <div
                      role="progressbar"
                      aria-label={`${source.name} indexing progress`}
                      aria-valuenow={percent}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
                    >
                      <div
                        className="h-full rounded-full bg-emerald-500"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })
      ) : (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5">
          <Loader2 className="size-4 shrink-0 animate-spin text-emerald-600" />
          <div className="min-w-0">
            <p className="text-xs font-medium">Indexing files</p>
            <p className="text-[11px] text-muted-foreground">
              {status.run?.warning ||
                (status.run?.totalChunks
                  ? `${status.run.processedChunks} of ${status.run.totalChunks} search chunks indexed`
                  : 'Preparing files for indexing')}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
