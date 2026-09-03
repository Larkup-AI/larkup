'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { AudioLines, Clock3, Image as ImageIcon, Loader2, Video } from 'lucide-react';
import { useLiveMediaProgress } from '@/hooks/use-live-media-progress';
import { LiveMediaProgress } from '@/components/data/live-media-progress';
import {
  describeActiveMediaStep,
  estimateMediaStepRemainingSeconds,
  formatMediaProgressPercent,
  isFinalizingMediaStep,
  mediaProcessingStartedAt,
  primaryRunningMediaStep,
} from '@/lib/media/progress';

export interface MediaIndexingAsset {
  id: string;
  type: 'image' | 'video' | 'audio';
  fileName: string;
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed';
  processingMessage?: string;
  processingProgress?: number;
  processingPaused?: boolean;
  processingStartedAt?: string;
  durationSecs?: number;
  createdAt: string;
  processingSteps?: Array<{
    stage: string;
    status: 'waiting' | 'running' | 'completed' | 'skipped' | 'failed';
    percent?: number;
    current?: number;
    total?: number;
    unit?: string;
    estimatedRemainingSeconds?: number;
    elapsedSeconds?: number;
    sequence?: number;
    message?: string;
    startedAt?: string;
    updatedAt?: string;
  }>;
}

export interface MediaIndexingResponse {
  assets: MediaIndexingAsset[];
}

export function isActiveMediaIndexing(asset: MediaIndexingAsset): boolean {
  return (
    asset.processingStatus === 'processing' ||
    (asset.processingStatus === 'pending' && Boolean(asset.processingMessage))
  );
}

export function MediaIndexingJobsPanel({ assets }: { assets: MediaIndexingAsset[] }) {
  if (assets.length === 0) return null;

  return (
    <section aria-label="Media indexing progress" className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium text-foreground">
        <Video className="size-3.5 text-emerald-600" />
        Media indexing
        <span className="text-muted-foreground">{assets.length} active</span>
      </div>
      <div className="space-y-2">
        {assets.map((asset) => (
          <MediaIndexingJob key={asset.id} asset={asset} />
        ))}
      </div>
    </section>
  );
}

function MediaIndexingJob({ asset }: { asset: MediaIndexingAsset }) {
  const Icon = asset.type === 'video' ? Video : asset.type === 'audio' ? AudioLines : ImageIcon;
  const progress = useLiveMediaProgress(asset);
  const activeStep = primaryRunningMediaStep(asset.processingSteps);
  const stepDescription = describeActiveMediaStep(activeStep);
  const isFinalizing = isFinalizingMediaStep(activeStep);
  const isColdStart = !asset.processingPaused && progress === 0;

  return (
    <article className="rounded-md border border-border/70 bg-background/70 px-3 py-2.5">
      <div className="flex min-w-0 items-start gap-2.5">
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
          <Icon className="size-3.5" />
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-xs font-medium text-foreground">{asset.fileName}</p>
            <ElapsedTime startTime={mediaProcessingStartedAt(asset)} />
          </div>
          <div className="flex min-w-0 items-center gap-1.5" aria-live="polite">
            {asset.processingPaused ? (
              <Clock3 className="size-3 shrink-0 text-amber-600" />
            ) : (
              <Loader2 className="size-3 shrink-0 animate-spin text-emerald-600" />
            )}
            <p className="truncate text-[11px] text-muted-foreground">
              {asset.processingPaused
                ? 'Paused — resume when you are ready.'
                : asset.processingMessage || 'Preparing media indexing…'}
            </p>
          </div>
          {isFinalizing ? (
            <div
              role="progressbar"
              aria-label={`Finalizing ${asset.fileName}`}
              aria-valuetext="Finalizing verified results"
              className="relative h-2 min-h-2 w-full overflow-hidden rounded-full bg-emerald-100 dark:bg-emerald-950/60"
            >
              <motion.div
                className="absolute inset-y-0 left-0 w-2/5 rounded-full bg-emerald-500 dark:bg-emerald-400"
                initial={{ x: '-120%' }}
                animate={{ x: ['-120%', '270%'] }}
                transition={{ duration: 1.15, ease: 'easeInOut', repeat: Infinity }}
              />
            </div>
          ) : (
            <LiveMediaProgress
              value={progress}
              step={activeStep}
              paused={asset.processingPaused}
              label={`Overall indexing progress for ${asset.fileName}`}
              className="h-1.5"
            />
          )}
          <div className="flex min-w-0 items-center justify-between gap-2 text-[10px] text-muted-foreground">
            <span className="truncate">
              {stepDescription || (isColdStart ? 'Starting GPU worker…' : 'Processing…')}
            </span>
            <div className="flex shrink-0 items-center gap-1.5 tabular-nums">
              <EstimatedStepTime step={activeStep} />
              <span>
                {isFinalizing ? 'Finalizing' : `${formatMediaProgressPercent(progress)}%`}
              </span>
            </div>
          </div>
          {isColdStart && (
            <p className="text-[10px] text-muted-foreground/80">
              The first GPU job can take a minute or two to start.
            </p>
          )}
        </div>
      </div>
    </article>
  );
}

function EstimatedStepTime({
  step,
}: {
  step: NonNullable<MediaIndexingAsset['processingSteps']>[number] | undefined;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(interval);
  }, []);
  const remainingSeconds = estimateMediaStepRemainingSeconds(step, now);
  if (remainingSeconds === null) return null;
  const minutes = Math.round(remainingSeconds / 60);
  const label =
    minutes < 1
      ? '<1m'
      : minutes < 60
        ? `~${minutes}m`
        : `~${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return <span title="Estimated time remaining from completed remote work">{label} left</span>;
}

function ElapsedTime({ startTime }: { startTime: string }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = new Date(startTime).getTime();
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    update();
    const interval = setInterval(update, 1_000);
    return () => clearInterval(interval);
  }, [startTime]);

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  return (
    <span className="shrink-0 font-mono tabular-nums text-[10px] text-muted-foreground/70">
      {minutes}:{seconds.toString().padStart(2, '0')}
    </span>
  );
}
