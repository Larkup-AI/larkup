'use client';

import { VideoIcon } from 'lucide-react';
import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface GpuActivity {
  id: string;
  label: string;
  message: string;
  percent: number;
  phase: 'waking-up' | 'analyzing';
  toolCallId?: string;
}

interface GpuActivityStatus {
  activity: GpuActivity | null;
}

/** A small circular percent ring, no external chart dependency. */
function CircularProgress({ percent }: { percent: number }) {
  const radius = 14;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" className="shrink-0 -rotate-90">
      <circle
        cx="16"
        cy="16"
        r={radius}
        className="stroke-emerald-500/20"
        strokeWidth="3"
        fill="none"
      />
      <circle
        cx="16"
        cy="16"
        r={radius}
        className="stroke-emerald-500 transition-[stroke-dashoffset] duration-500"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference - (clamped / 100) * circumference}
      />
    </svg>
  );
}

/**
 * A chat tool call (video re-inspection) can dispatch to a remote GPU
 * worker that's cold and takes tens of seconds to wake up. This shows
 * *only* that cold-start wait -- once the worker is actually analyzing,
 * progress moves inline into the chat transcript's own tool-call row
 * instead (see message-item.tsx), so this never shows raw internal state.
 * Same corner as GlobalIndexProgress, stacked above it so they never
 * overlap.
 */
export function GpuActivityIndicator() {
  const { data } = useSWR<GpuActivityStatus>('/api/gpu-activity', fetcher, {
    refreshInterval: (d) => (d?.activity?.phase === 'waking-up' ? 1_000 : 4_000),
  });

  const activity = data?.activity;
  // Chat-owned activity renders inline from the first update onward. Keeping
  // it out of this global surface avoids a visible handoff/flicker at the
  // waking-up → analyzing boundary.
  if (!activity || activity.phase !== 'waking-up' || activity.toolCallId) return null;

  return (
    <div className="fixed bottom-24 right-6 z-50">
      <div className="flex items-center gap-3 rounded-xl border bg-white dark:bg-background px-3 py-2 text-sm font-medium shadow-xs">
        <CircularProgress percent={activity.percent} />
        <div className="flex flex-col items-start gap-0.5 pr-1">
          <div className="flex items-center gap-1">
            <VideoIcon className="size-4" />
            <span className="text-xs leading-none text-muted-foreground">{activity.label}</span>
          </div>
          <span className="larkup-shimmer-text leading-none">{activity.message}</span>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {Math.round(activity.percent)}%
          </span>
        </div>
      </div>
    </div>
  );
}
