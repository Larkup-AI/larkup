'use client';

import { useState } from 'react';
import { ChevronDown, Loader2, Database } from 'lucide-react';

interface KBHit {
  title: string;
  url: string;
  score: number;
  text: string;
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
  const queries = parts
    .map((part: any) => {
      if (part.type === 'tool-invocation') {
        return part.toolInvocation?.args?.query;
      }
      return part.input?.query;
    })
    .filter(Boolean);

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
          <span className="truncate max-w-[250px] sm:max-w-[400px]">
            {isRunning
              ? 'Searching knowledge base…'
              : queries.length > 0
              ? `Searched knowledge base for "${queries[0]}"`
              : 'Searched knowledge base'}
          </span>
          {!isRunning && hits.length > 0 ? (
            <span className="shrink-0 text-[10px] bg-secondary text-foreground px-1.5 py-0.5 rounded-full font-medium ml-1">
              {hits.length} result{hits.length === 1 ? '' : 's'}
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
        <div className="mt-2 flex flex-col gap-px border border-border rounded-xl bg-border overflow-hidden">
          {hits.map((h, i) => (
            <div key={i} className="bg-card px-3.5 py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {(h as any).mediaType && (
                    <span className="shrink-0 text-[11px]">
                      {(h as any).mediaType === 'image' && '🖼️'}
                      {(h as any).mediaType === 'video' && '🎬'}
                      {(h as any).mediaType === 'audio' && '🎵'}
                    </span>
                  )}
                  <span className="truncate text-sm font-medium text-foreground">{h.title}</span>
                </div>
                <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                  {Math.round(h.score * 100)}%
                </span>
              </div>
              {h.url ? (
                <div className="mt-1.5 flex flex-col gap-1">
                  <a
                    href={h.url}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate text-xs text-primary hover:underline"
                  >
                    View Source ↗
                  </a>
                  {(h as any).mediaType === 'image' || h.url.match(/\.(jpeg|jpg|gif|png)$/i) ? (
                    <img
                      src={h.url}
                      alt="Source preview"
                      className="mt-1 max-h-32 rounded-md object-contain border border-border/50 bg-muted/20"
                    />
                  ) : null}
                  {/* If there are embedded images in the hit metadata (e.g. from PDF) */}
                  {((h as any).metadata?.images || []).map((img: any, idx: number) => (
                    <img
                      key={idx}
                      src={img.imageUrl}
                      alt={`Extracted image ${img.index}`}
                      className="mt-1 max-h-32 rounded-md object-contain border border-border/50 bg-muted/20"
                    />
                  ))}
                </div>
              ) : null}
              {(h as any).startSecs !== undefined && (
                <div className="mt-0.5 text-[11px] text-muted-foreground/70 tabular-nums">
                  ⏱ {formatTimeSecs((h as any).startSecs)}
                  {(h as any).endSecs !== undefined && ` – ${formatTimeSecs((h as any).endSecs)}`}
                </div>
              )}
              <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                {h.text}
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function formatTimeSecs(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
