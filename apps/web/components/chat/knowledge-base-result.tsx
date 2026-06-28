"use client";

import { useState } from "react";
import { ChevronDown, Loader2, Database } from "lucide-react";

interface KBHit {
  title: string;
  url: string;
  score: number;
  text: string;
}

export function KnowledgeBaseResult({
  parts,
  isShimmering,
}: {
  parts: any[];
  isShimmering?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const isRunning = parts.some(
    (part) =>
      part.toolInvocation?.state === "call" ||
      part.toolInvocation?.state === "partial-call",
  );
  const hits: KBHit[] = parts.flatMap(
    (part) => part.toolInvocation?.result?.hits ?? [],
  );
  const queries = parts
    .map((part) => part.toolInvocation?.args?.query)
    .filter(Boolean);

  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-card">
      {isShimmering && (
        <div className="pointer-events-none absolute inset-0 z-10 animate-pulse bg-gradient-to-r from-transparent via-foreground/5 to-transparent" />
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
            {isRunning ? "Searching knowledge base…" : "Knowledge base"}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {queries.length > 0
              ? `"${queries[0]}"${queries.length > 1 ? ` and ${queries.length - 1} more` : ""}`
              : "RAG retrieval"}
            {!isRunning
              ? ` · ${hits.length} ${hits.length === 1 ? "result" : "results"}`
              : ""}
          </div>
        </div>
        {!isRunning && hits.length > 0 ? (
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition ${open ? "rotate-180" : ""}`}
          />
        ) : null}
      </button>

      {open && hits.length > 0 ? (
        <div className="flex flex-col gap-px border-t border-border bg-border">
          {hits.map((h, i) => (
            <div key={i} className="bg-card px-3.5 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-foreground">
                  {h.title}
                </span>
                <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                  {Math.round(h.score * 100)}%
                </span>
              </div>
              {h.url ? (
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  {h.url}
                </div>
              ) : null}
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
