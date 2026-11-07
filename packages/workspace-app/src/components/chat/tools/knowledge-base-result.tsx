'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  Database,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Loader2,
} from 'lucide-react';
import { isIndeterminateProgress } from '../../../lib/chat/live-tool-progress';

function Typewriter({ text, animate }: { text: string; animate: boolean }) {
  const [length, setLength] = useState(animate ? 0 : text.length);

  useEffect(() => {
    if (!animate) {
      setLength(text.length);
      return;
    }
    setLength((prev) => Math.min(prev, text.length));
    const interval = setInterval(() => {
      setLength((prev) => {
        if (prev >= text.length) {
          clearInterval(interval);
          return prev;
        }
        return prev + 1;
      });
    }, 20);
    return () => clearInterval(interval);
  }, [text, animate]);

  return <>{text.substring(0, length)}</>;
}

interface KBHit {
  title: string;
  url: string;
  score: number;
  text: string;
  context?: string;
  timelineContext?: Array<{
    role: 'before' | 'matched' | 'after';
    text: string;
    startSecs?: number;
    endSecs?: number;
  }>;
  images?: { imageUrl: string; index: number; pageNumber?: number }[];
  metadata?: {
    mediaAssetId?: string;
    mediaType?: 'image' | 'video' | 'audio';
    fileName?: string;
    startSecs?: number;
    endSecs?: number;
    images?: { imageUrl: string; index: number }[];
  };
}

/**
 * Renders knowledge base retrieval results from tool-searchKnowledgeBase parts.
 */
export function KnowledgeBaseResult({
  parts,
  isShimmering,
  activity,
}: {
  parts: any[];
  isShimmering?: boolean;
  activity?: {
    percent: number;
    label: string;
    message: string;
    phase?: 'waking-up' | 'analyzing';
  } | null;
}) {
  const [open, setOpen] = useState(false);
  const isRunning = parts.some((part: any) => {
    // New format
    if (part.type === 'tool-invocation') {
      const state = part.toolInvocation?.state;
      return state === 'partial-call' || state === 'call';
    }
    // Legacy format
    return part.state === 'input-streaming' || part.state === 'input-available';
  });

  // Track if this component mounted while running (so we only animate new searches)
  const [isNew] = useState(isRunning);

  const query = useMemo(() => {
    for (const part of parts) {
      const rawArgs =
        part.type === 'tool-invocation' ? part.toolInvocation?.args : (part.input ?? part.args);
      if (rawArgs?.query) {
        return rawArgs.query;
      }
    }
    return '';
  }, [parts]);
  const hits = useMemo<KBHit[]>(
    () =>
      parts.flatMap((part: any) => {
        const rawResult =
          part.type === 'tool-invocation'
            ? part.toolInvocation?.result
            : (part.output ?? part.result);
        const result = parseToolResult(rawResult);
        return Array.isArray(result?.hits) ? result.hits : [];
      }),
    [parts],
  );
  const pdfHits = useMemo(
    () => [...new Map(hits.filter(isPdfHit).map((hit) => [hit.url || hit.title, hit])).values()],
    [hits],
  );
  const otherHits = useMemo(() => hits.filter((hit) => !isPdfHit(hit)), [hits]);
  const inspectedPages = useMemo(() => {
    const pages = new Map<string, Set<number>>();
    for (const part of parts) {
      const rawResult =
        part.type === 'tool-invocation'
          ? part.toolInvocation?.result
          : (part.output ?? part.result);
      const result = parseToolResult(rawResult) as {
        title?: string;
        pages?: Array<{ pageNumber?: number }>;
      } | null;
      if (!result?.title || !Array.isArray(result.pages)) continue;
      const selected = pages.get(result.title) ?? new Set<number>();
      for (const page of result.pages) {
        if (Number.isInteger(page.pageNumber)) selected.add(page.pageNumber!);
      }
      pages.set(result.title, selected);
    }
    return pages;
  }, [parts]);
  useEffect(() => {
    setOpen(isRunning);
  }, [isRunning]);

  return (
    <div className="mb-0 w-full p" data-testid="chat-citations">
      <div className="relative inline-flex items-center">
        {isShimmering && (
          <div className="pointer-events-none absolute inset-0 z-10 animate-pulse bg-linear-to-r from-transparent via-foreground/5 to-transparent" />
        )}
        <button
          type="button"
          onClick={() => hits.length > 0 && setOpen((o) => !o)}
          className={`flex items-center gap-2 pr-2 py-1.5 text-xs transition-colors duration-500 rounded-md ${
            hits.length > 0 ? 'hover:bg-muted/50 cursor-pointer' : 'cursor-default'
          } ${isRunning ? 'text-foreground' : 'text-muted-foreground'}`}
        >
          {isRunning ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
          ) : (
            <Database className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="truncate max-w-62.5 sm:max-w-100">
            {query ? (
              <>
                <span className="mr-1">{isRunning ? 'Searching' : 'Searched'}</span>
                <span className="font-medium">
                  &ldquo;
                  <Typewriter text={query} animate={isNew} />
                  &rdquo;
                </span>
              </>
            ) : isRunning ? (
              'Finding relevant sources…'
            ) : hits.length > 0 ? (
              'Sources'
            ) : (
              'No matching sources'
            )}
          </span>
          {!isRunning && hits.length > 0 ? (
            <span className="shrink-0 text-[10px] text-muted-foreground font-medium ml-1">
              {hits.length} source{hits.length === 1 ? '' : 's'}
            </span>
          ) : null}
          {!isRunning && hits.length > 0 ? (
            <ChevronDown
              className={`h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
            />
          ) : null}
        </button>
      </div>

      {isRunning && activity ? (
        <div
          className="mt-2.5 max-w-2xl rounded-xl border border-emerald-500/70 bg-background px-3 py-2.5"
          aria-live="polite"
          data-testid="video-analysis-progress"
        >
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="larkup-shimmer-text font-medium">{activity.message}</span>
            {isIndeterminateProgress(activity.percent) ? null : (
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {Math.max(1, Math.round(activity.percent))}%
              </span>
            )}
          </div>
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-emerald-950/10 dark:bg-emerald-100/10"
            role="progressbar"
            aria-label={activity.message}
            aria-valuemin={0}
            aria-valuemax={100}
            {...(isIndeterminateProgress(activity.percent)
              ? {}
              : { 'aria-valuenow': Math.max(1, Math.round(activity.percent)) })}
          >
            {isIndeterminateProgress(activity.percent) ? (
              <div className="larkup-progress-shuttle h-full rounded-full bg-emerald-500" />
            ) : (
              <div
                className="h-full rounded-full bg-emerald-500 transition-[width] duration-700 ease-out"
                style={{ width: `${Math.max(6, Math.min(100, activity.percent))}%` }}
              />
            )}
          </div>
        </div>
      ) : null}

      {open && hits.length > 0 ? (
        <div className="mt-1.5 pl-0.5" data-testid="citation-list">
          {isRunning && hits.length === 0 ? (
            <div className="flex items-center gap-2 py-2">
              <Loader2 className="size-3 animate-spin text-muted-foreground" />
            </div>
          ) : null}
          {pdfHits.length > 0 ? (
            <details open className="group" data-testid="pdf-source-list">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
                <ChevronDown className="size-3 transition-transform group-open:rotate-180" />
                <img src="/icons/pdf.png" alt="" className="size-3.5 object-contain" />
                PDFs ({pdfHits.length})
              </summary>
              <div className="ml-4">
                {pdfHits.map((hit, index) => (
                  <SourceRow
                    key={`${hit.title}-${index}`}
                    hit={hit}
                    compact
                    selectedPages={[...(inspectedPages.get(hit.title) ?? [])].sort((a, b) => a - b)}
                  />
                ))}
              </div>
            </details>
          ) : null}
          {otherHits.map((hit, index) => (
            <SourceRow key={`${hit.title}-${index}`} hit={hit} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function contextForHit(hit: KBHit) {
  const direct = hit.context?.trim();
  if (direct) return direct;
  const matched = hit.timelineContext?.find((item) => item.role === 'matched')?.text?.trim();
  if (matched) return matched;
  const text = hit.text?.trim();
  return text && !text.startsWith('Verified media evidence is available') ? text : '';
}

function formatTimestamp(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const rest = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    : `${minutes}:${String(rest).padStart(2, '0')}`;
}

function parseToolResult(value: unknown): { hits?: KBHit[] } | null {
  if (typeof value === 'string') {
    try {
      return parseToolResult(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return typeof value === 'object' && value !== null ? (value as { hits?: KBHit[] }) : null;
}

function isSafeSourceUrl(url: string | undefined) {
  return Boolean(url && (url.startsWith('/') || /^https?:\/\//i.test(url)));
}

function isPdfHit(hit: KBHit) {
  return /\.pdf(?:$|[?#])/iu.test(hit.title ?? '') || /\.pdf(?:$|[?#])/iu.test(hit.url ?? '');
}

function SourceRow({
  hit,
  compact = false,
  selectedPages = [],
}: {
  hit: KBHit;
  compact?: boolean;
  selectedPages?: number[];
}) {
  const pdf = isPdfHit(hit);
  return (
    <div className="flex gap-2 py-1.5" data-testid="citation-source">
      {pdf ? (
        <img src="/icons/pdf.png" alt="" className="mt-0.5 size-3.5 shrink-0 object-contain" />
      ) : (
        <SourceThumbnail hit={hit} />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <SourceTitle hit={hit} />
          {isSafeSourceUrl(hit.url) ? (
            <a
              href={hit.url}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open ${hit.title}`}
              className="mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-foreground"
            >
              <ExternalLink className="size-3.5" />
            </a>
          ) : null}
        </div>
        {compact && selectedPages.length > 0 ? (
          <span className="text-[11px] text-muted-foreground">
            {selectedPages.length === 1 ? 'Page' : 'Pages'} {selectedPages.join(', ')}
          </span>
        ) : null}
        {!compact && hit.metadata?.mediaType ? (
          <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="capitalize">{hit.metadata.mediaType} source</span>
            {Number.isFinite(hit.metadata.startSecs) ? (
              <span className="font-mono tabular-nums">
                {formatTimestamp(hit.metadata.startSecs!)}
                {Number.isFinite(hit.metadata.endSecs)
                  ? `–${formatTimestamp(hit.metadata.endSecs!)}`
                  : ''}
              </span>
            ) : null}
          </div>
        ) : null}
        {!compact && contextForHit(hit) ? (
          <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground" dir="auto">
            {contextForHit(hit)}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function SourceTitle({ hit }: { hit: KBHit }) {
  const title = hit.title || 'Untitled source';
  const className =
    'line-clamp-1 text-xs font-medium text-foreground transition-colors hover:text-primary hover:underline';
  return isSafeSourceUrl(hit.url) ? (
    <a href={hit.url} target="_blank" rel="noreferrer" className={className}>
      {title}
    </a>
  ) : (
    <span className="line-clamp-1 text-xs font-medium text-foreground">{title}</span>
  );
}

function SourceThumbnail({ hit }: { hit: KBHit }) {
  const [imageUnavailable, setImageUnavailable] = useState(false);
  const image = (hit.images ?? hit.metadata?.images)?.find((candidate) =>
    isSafeSourceUrl(candidate.imageUrl),
  );
  if (image && !imageUnavailable) {
    return (
      // Retrieval supplies this URL; it is never a model-suggested placeholder.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={image.imageUrl}
        alt=""
        className="size-11 shrink-0 rounded-md border border-border object-cover"
        loading="lazy"
        onError={() => setImageUnavailable(true)}
      />
    );
  }

  return (
    <div className="flex size-11 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40 text-muted-foreground">
      {hit.metadata?.mediaType === 'image' ? (
        <ImageIcon className="size-4" />
      ) : (
        <FileText className="size-4" />
      )}
    </div>
  );
}
