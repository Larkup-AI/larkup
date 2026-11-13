'use client';

import { Activity } from 'lucide-react';
import type { MetricsBlock, MetricItem } from '../../../lib/chat/rich-blocks';

const ITEM_ACCENTS = [
  'bg-foreground/80',
  'bg-muted-foreground/60',
  'bg-emerald-600 dark:bg-emerald-400',
  'bg-blue-600 dark:bg-blue-400',
  'bg-amber-600 dark:bg-amber-400',
];

export function ChatMetricCards({ block }: { block: MetricsBlock }) {
  const { title, items, highlight } = block;
  if (!items?.length && !highlight) return null;

  return (
    <div
      data-testid="chat-metrics-card"
      className="my-3.5 w-full overflow-hidden rounded-2xl border border-border/75 bg-card/95 p-4 sm:p-5 transition-colors"
    >
      {title && (
        <div className="mb-3.5 flex items-center gap-2 border-b border-border/40 pb-2.5">
          <Activity className="size-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold tracking-wide text-foreground">{title}</span>
        </div>
      )}

      <div
        className={`grid gap-5 ${
          highlight
            ? 'grid-cols-1 md:grid-cols-[1fr_auto_minmax(180px,260px)] md:items-center'
            : 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3'
        }`}
      >
        {/* Main items column / grid */}
        <div className="flex flex-col justify-center gap-3">
          {items.map((item, idx) => (
            <MetricRow key={`${item.label}-${idx}`} item={item} accentIndex={idx} />
          ))}
        </div>

        {/* Vertical divider if highlight exists */}
        {highlight && (
          <>
            <div className="hidden h-full w-px bg-border/60 md:block" />
            <div className="flex flex-col justify-center rounded-xl bg-muted/30 p-3.5 md:bg-transparent md:p-0">
              <span className="text-xs font-medium text-muted-foreground">{highlight.label}</span>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="font-mono text-2xl font-bold tracking-tight text-foreground sm:text-3xl tabular-nums">
                  {highlight.value}
                </span>
                {highlight.unit && (
                  <span className="text-sm font-semibold text-muted-foreground">
                    {highlight.unit}
                  </span>
                )}
              </div>
              {highlight.note && (
                <span className="mt-1 text-[11px] font-mono text-muted-foreground/90">
                  {highlight.note}
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function MetricRow({ item, accentIndex }: { item: MetricItem; accentIndex: number }) {
  const accent = ITEM_ACCENTS[accentIndex % ITEM_ACCENTS.length];

  return (
    <div className="flex items-center justify-between gap-4 py-0.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className={`size-2.5 shrink-0 rounded-sm ${accent}`} aria-hidden="true" />
        <span className="truncate text-xs sm:text-sm font-medium text-foreground">
          {item.label}
        </span>
      </div>

      <div className="flex shrink-0 items-baseline gap-1 tabular-nums">
        <span className="font-mono text-lg sm:text-xl font-bold text-foreground">{item.value}</span>
        {item.unit && (
          <span className="text-xs font-medium text-muted-foreground">{item.unit}</span>
        )}
        {item.note && (
          <span className="ml-1 rounded bg-muted/60 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
            {item.note}
          </span>
        )}
      </div>
    </div>
  );
}
