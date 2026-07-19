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
    <div className="relative overflow-hidden rounded-xl border border-border bg-card">
      {isShimmering && (
        <div className="pointer-events-none absolute inset-0 z-10 animate-pulse bg-linear-to-r from-transparent via-foreground/5 to-transparent" />
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-3.5 py-3 text-left"
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground">
          {isRunning ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Database className="size-4" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">
            {isRunning ? 'Searching knowledge base…' : 'Knowledge base'}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {queries.length > 0
              ? `"${queries[0]}"${queries.length > 1 ? ` and ${queries.length - 1} more` : ''}`
              : 'RAG retrieval'}
            {!isRunning ? ` · ${hits.length} ${hits.length === 1 ? 'result' : 'results'}` : ''}
          </div>
        </div>
        {!isRunning && hits.length > 0 ? (
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition ${open ? 'rotate-180' : ''}`}
          />
        ) : null}
      </button>

      {open && hits.length > 0 ? (
        <div className="flex flex-col gap-px border-t border-border bg-border">
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
                <div className="mt-0.5 truncate text-xs text-muted-foreground">{h.url}</div>
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
