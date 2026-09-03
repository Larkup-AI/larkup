'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  formatMediaProgressPercent,
  isMediaStepTelemetryStale,
  type MediaProgressStep,
} from '@/lib/media/progress';
import { cn } from '@/lib/utils';

export function LiveMediaProgress({
  value,
  step,
  paused = false,
  label = 'Overall indexing progress',
  className,
}: {
  value: number;
  step?: MediaProgressStep;
  paused?: boolean;
  label?: string;
  className?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (paused) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [paused]);

  const bounded = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const stale = isMediaStepTelemetryStale(step, now);
  const live = !paused && !stale && bounded < 100;
  const formatted = formatMediaProgressPercent(bounded);
  const liveTrackStart = Math.min(96, Math.max(0, bounded));
  const status = paused
    ? `${formatted}% progress, paused`
    : stale
      ? `${formatted}% progress, waiting for worker update`
      : `${formatted}% progress, worker activity`;

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(bounded * 10) / 10}
      aria-valuetext={status}
      data-live-progress={live ? 'active' : stale ? 'stale' : paused ? 'paused' : 'idle'}
      className={cn(
        'relative h-1 w-full overflow-hidden rounded-full bg-muted',
        stale && 'opacity-60',
        className,
      )}
    >
      <motion.div
        className="absolute inset-y-0 left-0 rounded-full bg-emerald-500 dark:bg-emerald-400"
        animate={{ width: `${bounded}%` }}
        transition={{ duration: 0.55, ease: 'easeOut' }}
      />
      {live ? (
        <div
          data-testid="live-indexing-progress-pulse"
          className="absolute inset-y-0 right-0 overflow-hidden"
          style={{ left: `${liveTrackStart}%` }}
        >
          <motion.span
            className="absolute inset-y-0 w-1/4 rounded-full bg-linear-to-r from-transparent via-emerald-400/75 to-transparent dark:via-emerald-300/75"
            initial={{ x: '-120%' }}
            animate={{ x: ['-120%', '420%'] }}
            transition={{ duration: 1.35, ease: 'linear', repeat: Infinity }}
          />
        </div>
      ) : null}
    </div>
  );
}
