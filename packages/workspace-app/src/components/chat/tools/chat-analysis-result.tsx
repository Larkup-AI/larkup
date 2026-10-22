'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Search,
  Table2,
} from 'lucide-react';
import { Button } from '@larkup/workspace-ui/button';
import { Input } from '../../ui/input';
import { cn } from '../../../lib/utils';
import { ChatDataTable } from './chat-data-table';

export interface AnalysisTablePresentation {
  kind: 'table';
  title: string;
  summary?: string;
  columns: string[];
  rows: Array<Record<string, string | number | boolean | null>>;
  totalItems: number;
  requestedItems?: number;
  complete: boolean;
  fileName?: string;
}

export interface AnalysisDocumentPresentation {
  kind: 'document';
  title: string;
  summary?: string;
  pages: Array<{ title?: string; content: string }>;
  totalItems: number;
  requestedItems?: number;
  complete: boolean;
  fileName?: string;
}

export type AnalysisPresentation = AnalysisTablePresentation | AnalysisDocumentPresentation;

function safeFileName(value: string | undefined, fallback: string, extension: string) {
  const stem = (value || fallback)
    .replace(/\.[^.]+$/, '')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
  return `${stem || fallback}.${extension}`;
}

function downloadText(presentation: AnalysisDocumentPresentation) {
  const text = presentation.pages
    .map((page, index) =>
      [page.title || `Page ${index + 1}`, page.content].filter(Boolean).join('\n\n'),
    )
    .join('\n\n---\n\n');
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = safeFileName(presentation.fileName, presentation.title, 'txt');
  anchor.click();
  URL.revokeObjectURL(url);
}

function Coverage({ presentation }: { presentation: AnalysisPresentation }) {
  const requested = presentation.requestedItems;
  const prepared =
    presentation.kind === 'table' ? presentation.rows.length : presentation.pages.length;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium tabular-nums',
        presentation.complete
          ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
          : 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
      )}
    >
      {presentation.complete && <CheckCircle2 className="size-3" />}
      {prepared.toLocaleString()}
      {requested !== undefined ? ` of ${requested.toLocaleString()}` : ''} prepared
    </span>
  );
}

function DocumentReader({ presentation }: { presentation: AnalysisDocumentPresentation }) {
  const [pageIndex, setPageIndex] = useState(0);
  const [query, setQuery] = useState('');
  const matchingPageIndexes = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return presentation.pages.map((_, index) => index);
    return presentation.pages.flatMap((page, index) =>
      `${page.title ?? ''}\n${page.content}`.toLocaleLowerCase().includes(normalized)
        ? [index]
        : [],
    );
  }, [presentation.pages, query]);
  const visibleIndex = matchingPageIndexes.includes(pageIndex)
    ? pageIndex
    : (matchingPageIndexes[0] ?? 0);
  const visiblePosition = Math.max(0, matchingPageIndexes.indexOf(visibleIndex));
  const page = presentation.pages[visibleIndex];
  const go = useCallback(
    (offset: number) => {
      const nextPosition = Math.min(
        Math.max(visiblePosition + offset, 0),
        Math.max(matchingPageIndexes.length - 1, 0),
      );
      setPageIndex(matchingPageIndexes[nextPosition] ?? 0);
    },
    [matchingPageIndexes, visiblePosition],
  );

  return (
    <div className="overflow-hidden rounded-xl border border-border/80 bg-card">
      <div className="flex flex-col gap-3 border-b border-border/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative min-w-0 flex-1 sm:max-w-72">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search prepared pages"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPageIndex(0);
            }}
            placeholder="Search all pages…"
            className="h-8 pl-8 text-xs"
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => downloadText(presentation)}
          className="h-8 gap-1.5 text-xs text-muted-foreground"
        >
          <Download className="size-3.5" />
          TXT
        </Button>
      </div>

      {matchingPageIndexes.length === 0 ? (
        <div className="px-4 py-14 text-center text-sm text-muted-foreground">
          No prepared pages match “{query}”.
        </div>
      ) : (
        <article className="min-h-72 bg-background/50 px-5 py-6 sm:px-8 sm:py-8">
          <div className="mx-auto max-w-3xl">
            <div className="mb-5 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
              <span className="uppercase tracking-[0.16em]">Prepared page {visibleIndex + 1}</span>
              <span className="tabular-nums">
                {visiblePosition + 1} / {matchingPageIndexes.length}
                {query ? ' matches' : ''}
              </span>
            </div>
            {page?.title && (
              <h4 className="mb-4 text-lg font-semibold tracking-tight text-foreground">
                {page.title}
              </h4>
            )}
            <div className="whitespace-pre-wrap text-sm leading-7 text-foreground/90">
              {page?.content}
            </div>
          </div>
        </article>
      )}

      <div className="flex items-center justify-between border-t border-border/50 px-3 py-2">
        <Button
          variant="ghost"
          size="sm"
          aria-label="Previous prepared page"
          disabled={visiblePosition <= 0 || matchingPageIndexes.length === 0}
          onClick={() => go(-1)}
          className="h-8 gap-1.5 text-xs"
        >
          <ChevronLeft className="size-3.5" /> Previous
        </Button>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          Page {visibleIndex + 1} of {presentation.pages.length}
        </span>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Next prepared page"
          disabled={
            matchingPageIndexes.length === 0 || visiblePosition >= matchingPageIndexes.length - 1
          }
          onClick={() => go(1)}
          className="h-8 gap-1.5 text-xs"
        >
          Next <ChevronRight className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

export function ChatAnalysisResult({ presentation }: { presentation: AnalysisPresentation }) {
  const Icon = presentation.kind === 'table' ? Table2 : BookOpen;
  return (
    <section className="my-2 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="mb-1.5 flex items-start justify-between gap-3 px-0.5">
        <div className="flex min-w-0 items-start gap-2.5">
          <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Icon className="size-3.5" />
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-foreground">{presentation.title}</h3>
            {presentation.summary && (
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {presentation.summary}
              </p>
            )}
          </div>
        </div>
        <Coverage presentation={presentation} />
      </div>

      {presentation.kind === 'table' ? (
        <ChatDataTable
          config={{
            columns: presentation.columns,
            rows: presentation.rows,
            totalRows: presentation.totalItems,
            truncated: !presentation.complete,
            fileName: presentation.fileName || presentation.title,
          }}
        />
      ) : (
        <DocumentReader presentation={presentation} />
      )}
    </section>
  );
}
