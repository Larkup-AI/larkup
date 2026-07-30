'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, Loader2, Database } from 'lucide-react';

interface KBHit {
  title: string;
  url: string;
  score: number;
  text: string;
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
  const hits: KBHit[] = parts.flatMap((part: any) => {
    // New format
    if (part.type === 'tool-invocation') {
      return part.toolInvocation?.result?.hits ?? [];
    }
    // Legacy format
    return part.output?.hits ?? [];
  });
  // Show a live search surface, then return to the compact conversation once
  // the tool has completed. Results remain available via the trigger button.
  useEffect(() => {
    setOpen(isRunning);
  }, [isRunning]);

  return (
    <div className="mb-2 w-full">
      <div className="relative inline-flex items-center">
        {isShimmering && (
          <div className="pointer-events-none absolute inset-0 z-10 animate-pulse bg-linear-to-r from-transparent via-foreground/5 to-transparent" />
        )}
        <button
          type="button"
          onClick={() => hits.length > 0 && setOpen((o) => !o)}
          className={`flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground transition-colors rounded-md ${
            hits.length > 0 ? 'hover:bg-muted/50 cursor-pointer' : 'cursor-default'
          }`}
        >
          {isRunning ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
          ) : (
            <Database className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="truncate max-w-62.5 sm:max-w-100">
            {isRunning ? 'Checking knowledge base…' : 'Checked knowledge base'}
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
        <div className="mt-2 flex flex-col gap-px border border-border rounded-xl bg-transparent overflow-hidden">
          {isRunning && hits.length === 0 ? (
            <div className="flex items-center gap-2 px-3.5 py-2.5">
              <Loader2 className="size-3 animate-spin text-muted-foreground" />
            </div>
          ) : null}
          {hits.slice(0, 3).map((h, i) => (
            <div key={i} className="px-3.5 py-3 border-b border-border/50 last:border-0">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  {h.metadata?.mediaType && (
                    <span className="shrink-0 text-[11px]">
                      {h.metadata.mediaType === 'image' && '🖼️'}
                      {h.metadata.mediaType === 'video' && '🎬'}
                      {h.metadata.mediaType === 'audio' && '🎵'}
                    </span>
                  )}
                  <span className="truncate text-xs font-medium text-muted-foreground underline">
                    {h.title}
                  </span>
                  {h.url ? (
                    <a
                      href={h.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-primary hover:text-primary/80 shrink-0"
                    >
                      View Source
                    </a>
                  ) : null}
                </div>
                <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                  {Math.round(h.score * 100)}%
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
