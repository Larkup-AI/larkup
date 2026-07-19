'use client';

import useSWR from 'swr';
import { Loader2 } from 'lucide-react';
import type { IndexRun } from '@larkup/core/types';
import { IndexActionDialog } from './index-action-dialog';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface IndexStatus {
  run: IndexRun | null;
  running: boolean;
}

const ACTIVE: IndexRun['status'][] = ['chunking', 'embedding', 'upserting'];

export function GlobalIndexProgress() {
  const { data } = useSWR<IndexStatus>('/api/index', fetcher, {
    refreshInterval: (d) => (d?.run && ACTIVE.includes(d.run.status) ? 1000 : 0),
  });

  const running = Boolean(data?.run && ACTIVE.includes(data.run.status));

  if (!running || !data?.run) {
    return null;
  }

  const { run } = data;
  const pct = run.totalChunks > 0 ? Math.round((run.processedChunks / run.totalChunks) * 100) : 5; // indeterminate/start

  return (
    <div className="fixed bottom-6 right-6 z-50">
      <IndexActionDialog
        trigger={
          <button className="flex items-center gap-3 rounded-full border bg-background px-4 py-2 text-sm font-medium  transition-all hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
            <Loader2 className="size-4 animate-spin text-primary" />
            <div className="flex flex-col items-start gap-0.5">
              <span className="text-xs leading-none text-muted-foreground">Storing...</span>
              <span className="leading-none">{pct}%</span>
            </div>
          </button>
        }
      />
    </div>
  );
}
