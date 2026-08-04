'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  Database,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Loader2,
  Search,
  SearchIcon,
} from 'lucide-react';

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
 *
 * UIMessage parts for tools look like:
 *   { type: "tool-searchKnowledgeBase", state: "input-streaming" | "input-available" | "output", input: { query }, output: { query, hits } }
 */
export function KnowledgeBaseResult({
  parts,
  isShimmering,
}: {
  parts: any[];
  isShimmering?: boolean;
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
        part.type === 'tool-invocation' ? part.toolInvocation?.args : part.input ?? part.args;
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
            : part.output ?? part.result;
        const result = parseToolResult(rawResult);
        return Array.isArray(result?.hits) ? result.hits : [];
      }),
    [parts],
  );
  // Expand only while retrieval is running, then leave a compact source count
  // above the answer. The user can open it when they need the evidence.
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
            <span className="shrink-0 text-[10px] bg-secondary text-foreground px-1.5 py-0.5 rounded-full font-medium ml-1">
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

      {open && hits.length > 0 ? (
        <div
          className="mt-2 overflow-hidden rounded-xl border border-border bg-card"
          data-testid="citation-list"
        >
          {isRunning && hits.length === 0 ? (
            <div className="flex items-center gap-2 px-3.5 py-2.5">
              <Loader2 className="size-3 animate-spin text-muted-foreground" />
            </div>
          ) : null}
          {hits.slice(0, 4).map((h, i) => (
            <div
              key={`${h.title}-${i}`}
              className="flex gap-3 border-b border-border/60 px-3.5 py-3 last:border-0"
              data-testid="citation-source"
            >
              <SourceThumbnail hit={h} />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <SourceTitle hit={h} />
                  {isSafeSourceUrl(h.url) ? (
                    <a
                      href={h.url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Open ${h.title}`}
                      className="mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <ExternalLink className="size-3.5" />
                    </a>
                  ) : null}
                </div>
                {h.text ? (
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                    {h.text}
                  </p>
                ) : null}
                {h.metadata?.mediaType ? (
                  <p className="mt-1.5 text-[11px] capitalize text-muted-foreground">
                    {h.metadata.mediaType} source
                  </p>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
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
