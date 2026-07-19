'use client';

import { useState } from 'react';
import { ChevronDown, Database, FileText, Globe, Upload, Table2, Image } from 'lucide-react';
import { ChatDataTable, type DataTableConfig } from '@/components/chat/tools/chat-data-table';
import { Card } from '@/components/ui/card';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface CorpusDocumentSummary {
  id: string;
  title: string;
  source: string;
  url?: string;
  charCount: number;
  status?: string;
  metadata?: Record<string, any>;
  createdAt: string;
  content?: string;
}

interface CorpusSummary {
  totalDocuments: number;
  bySource: Record<string, number>;
  byStatus: Record<string, number>;
  topMetadataKeys: { key: string; count: number }[];
  totalCharacters: number;
  dateRange: { earliest: string; latest: string } | null;
}

export interface CorpusDataConfig {
  documents: CorpusDocumentSummary[];
  total: number;
  summary: CorpusSummary;
  error?: string;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const SOURCE_ICONS: Record<string, React.ReactNode> = {
  paste: <FileText className="size-3" />,
  upload: <Upload className="size-3" />,
  scrape: <Globe className="size-3" />,
  tabular: <Table2 className="size-3" />,
  media: <Image className="size-3" />,
};

const SOURCE_COLORS: Record<string, string> = {
  paste: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  upload: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  scrape: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  tabular: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  media: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400',
};

function formatChars(chars: number): string {
  if (chars >= 1_000_000) return `${(chars / 1_000_000).toFixed(1)}M`;
  if (chars >= 1_000) return `${(chars / 1_000).toFixed(1)}K`;
  return String(chars);
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function CorpusDataResult({ config }: { config: CorpusDataConfig }) {
  const [showTable, setShowTable] = useState(false);
  const { documents, total, summary, error } = config;

  if (error) {
    return (
      <Card className="overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-500">
        <div className="flex items-center gap-2 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          <Database className="size-4" />
          <span>Failed to fetch corpus data: {error}</span>
        </div>
      </Card>
    );
  }

  if (summary.totalDocuments === 0) {
    return (
      <Card className="overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-500">
        <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
          <Database className="size-4" />
          <span>No documents found in the corpus.</span>
        </div>
      </Card>
    );
  }

  // Build source badges
  const sourceEntries = Object.entries(summary.bySource).sort((a, b) => b[1] - a[1]);
  const statusEntries = Object.entries(summary.byStatus).sort((a, b) => b[1] - a[1]);

  // Build table config from documents
  const tableConfig: DataTableConfig | null =
    documents.length > 0
      ? {
          columns: ['title', 'source', 'status', 'charCount', 'createdAt'],
          rows: documents.map((d) => ({
            title: d.title,
            source: d.source,
            status: d.status ?? 'unindexed',
            charCount: d.charCount,
            createdAt: d.createdAt.split('T')[0],
            ...(d.url ? { url: d.url } : {}),
          })),
          totalRows: total,
        }
      : null;

  return (
    <Card className="overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-500">
      {/* Summary header */}
      <div className="border-b border-border/40 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Database className="size-3" />
            </div>
            <span className="text-sm font-medium text-foreground">Corpus Overview</span>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">
              {total.toLocaleString()} {total === 1 ? 'document' : 'documents'}
            </span>
          </div>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {formatChars(summary.totalCharacters)} chars
          </span>
        </div>

        {/* Source & status badges */}
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {sourceEntries.map(([source, count]) => (
            <span
              key={source}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                SOURCE_COLORS[source] ?? 'bg-secondary text-muted-foreground'
              }`}
            >
              {SOURCE_ICONS[source]}
              {source}
              <span className="tabular-nums font-normal opacity-70">{count}</span>
            </span>
          ))}
          {statusEntries.map(([status, count]) => (
            <span
              key={status}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                status === 'indexed'
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                  : 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
              }`}
            >
              {status}
              <span className="tabular-nums font-normal opacity-70">{count}</span>
            </span>
          ))}
        </div>

        {/* Metadata keys */}
        {summary.topMetadataKeys.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            <span className="text-[10px] text-muted-foreground/60 self-center mr-0.5">
              metadata:
            </span>
            {summary.topMetadataKeys.slice(0, 8).map(({ key, count }) => (
              <span
                key={key}
                className="rounded bg-secondary/60 px-1.5 py-0.5 text-[10px] text-muted-foreground"
              >
                {key} <span className="tabular-nums opacity-60">({count})</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Expandable document table */}
      {tableConfig && (
        <>
          <button
            type="button"
            onClick={() => setShowTable((o) => !o)}
            className="flex w-full items-center justify-between px-4 py-2 text-xs text-muted-foreground hover:bg-secondary/30 transition-colors"
          >
            <span>
              {showTable ? 'Hide' : 'Show'} documents ({documents.length}
              {total > documents.length ? ` of ${total}` : ''})
            </span>
            <ChevronDown
              className={`size-3.5 transition-transform ${showTable ? 'rotate-180' : ''}`}
            />
          </button>
          {showTable && (
            <div className="border-t border-border/40 px-3 py-3">
              <ChatDataTable config={tableConfig} />
            </div>
          )}
        </>
      )}
    </Card>
  );
}
