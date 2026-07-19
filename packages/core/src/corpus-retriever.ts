/**
 * Corpus retriever — structured access to raw source documents.
 *
 * This module provides lightweight, in-memory access to the documents
 * stored in `documents-store.ts` (the `documents.json` file). It is
 * designed for the chat agent's data introspection tools, NOT for
 * semantic search (which uses the vector store).
 *
 * Strategy:
 *   - Semantic search  → vector store (top-K via searchKnowledgeBase)
 *   - Data manipulation → this module (full corpus, filters, export)
 */

import { readDocuments } from './documents-store';
import type { SourceDocument, DocumentSource } from './types';

/* ------------------------------------------------------------------ */
/* Public types                                                        */
/* ------------------------------------------------------------------ */

export interface CorpusFilter {
  /** Filter by document source type */
  source?: DocumentSource;
  /** Filter by indexing status */
  status?: 'indexed' | 'unindexed';
  /** Filter by metadata key existence */
  metadataKey?: string;
  /** Filter by metadata key=value (requires metadataKey) */
  metadataValue?: string;
  /** Case-insensitive text search in title */
  titleContains?: string;
  /** Only docs created on or after this ISO date */
  createdAfter?: string;
  /** Only docs created on or before this ISO date */
  createdBefore?: string;
}

/** Lightweight document record returned by getCorpusDocuments (no content by default). */
export interface CorpusDocumentSummary {
  id: string;
  title: string;
  source: DocumentSource;
  url?: string;
  charCount: number;
  status?: 'indexed' | 'unindexed';
  metadata?: Record<string, any>;
  createdAt: string;
  /** Only included when `includeContent: true` */
  content?: string;
}

export interface CorpusSummary {
  totalDocuments: number;
  bySource: Record<string, number>;
  byStatus: Record<string, number>;
  topMetadataKeys: { key: string; count: number }[];
  totalCharacters: number;
  dateRange: { earliest: string; latest: string } | null;
}

export interface CorpusPage {
  documents: CorpusDocumentSummary[];
  total: number;
  summary: CorpusSummary;
}

/* ------------------------------------------------------------------ */
/* Filtering                                                           */
/* ------------------------------------------------------------------ */

function applyFilters(docs: SourceDocument[], filter?: CorpusFilter): SourceDocument[] {
  if (!filter) return docs;

  return docs.filter((doc) => {
    if (filter.source && doc.source !== filter.source) return false;
    if (filter.status && doc.status !== filter.status) return false;

    if (filter.titleContains) {
      const needle = filter.titleContains.toLowerCase();
      if (!doc.title.toLowerCase().includes(needle)) return false;
    }

    if (filter.createdAfter && doc.createdAt < filter.createdAfter) return false;
    if (filter.createdBefore && doc.createdAt > filter.createdBefore) return false;

    if (filter.metadataKey) {
      if (!doc.metadata || !(filter.metadataKey in doc.metadata)) return false;
      if (
        filter.metadataValue !== undefined &&
        String(doc.metadata[filter.metadataKey]) !== filter.metadataValue
      ) {
        return false;
      }
    }

    return true;
  });
}

/* ------------------------------------------------------------------ */
/* Summary computation                                                 */
/* ------------------------------------------------------------------ */

function computeSummary(docs: SourceDocument[]): CorpusSummary {
  const bySource: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const metadataKeyCounts: Record<string, number> = {};
  let totalChars = 0;
  let earliest = '';
  let latest = '';

  for (const doc of docs) {
    // By source
    bySource[doc.source] = (bySource[doc.source] ?? 0) + 1;

    // By status
    const status = doc.status ?? 'unindexed';
    byStatus[status] = (byStatus[status] ?? 0) + 1;

    // Characters
    totalChars += doc.charCount;

    // Date range
    if (!earliest || doc.createdAt < earliest) earliest = doc.createdAt;
    if (!latest || doc.createdAt > latest) latest = doc.createdAt;

    // Metadata keys
    if (doc.metadata) {
      for (const key of Object.keys(doc.metadata)) {
        // Skip internal keys (start with _)
        if (key.startsWith('_')) continue;
        metadataKeyCounts[key] = (metadataKeyCounts[key] ?? 0) + 1;
      }
    }
  }

  const topMetadataKeys = Object.entries(metadataKeyCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([key, count]) => ({ key, count }));

  return {
    totalDocuments: docs.length,
    bySource,
    byStatus,
    topMetadataKeys,
    totalCharacters: totalChars,
    dateRange: earliest ? { earliest, latest } : null,
  };
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Get corpus documents with optional filtering and pagination.
 * Returns metadata-only by default (no content) to keep responses small.
 */
export async function getCorpusDocuments(
  filter?: CorpusFilter,
  limit = 200,
  offset = 0,
  includeContent = false,
): Promise<CorpusPage> {
  const allDocs = await readDocuments();
  const filtered = applyFilters(allDocs, filter);
  const total = filtered.length;
  const page = filtered.slice(offset, offset + limit);

  const documents: CorpusDocumentSummary[] = page.map((doc) => {
    const summary: CorpusDocumentSummary = {
      id: doc.id,
      title: doc.title,
      source: doc.source,
      url: doc.url,
      charCount: doc.charCount,
      status: doc.status,
      metadata: doc.metadata,
      createdAt: doc.createdAt,
    };
    if (includeContent) {
      // Cap content at 2000 chars per doc to prevent context explosion
      summary.content = doc.content.slice(0, 2000);
    }
    return summary;
  });

  return {
    documents,
    total,
    summary: computeSummary(filtered),
  };
}

/**
 * Get a lightweight summary of the entire corpus.
 */
export async function getCorpusSummary(): Promise<CorpusSummary> {
  const allDocs = await readDocuments();
  return computeSummary(allDocs);
}

/**
 * Export the corpus as a CSV string for sandbox injection.
 *
 * Flattens top-level metadata keys into separate columns.
 * Skips internal metadata keys (prefixed with `_`).
 */
export async function exportCorpusAsCSV(
  filter?: CorpusFilter,
  maxContentChars = 1000,
): Promise<string> {
  const allDocs = await readDocuments();
  const filtered = applyFilters(allDocs, filter);

  if (filtered.length === 0) return '';

  // Collect all non-internal metadata keys across all docs
  const metaKeys = new Set<string>();
  for (const doc of filtered) {
    if (doc.metadata) {
      for (const key of Object.keys(doc.metadata)) {
        if (!key.startsWith('_')) metaKeys.add(key);
      }
    }
  }
  const sortedMetaKeys = [...metaKeys].sort();

  // Build header
  const baseColumns = [
    'id',
    'title',
    'source',
    'url',
    'charCount',
    'status',
    'createdAt',
    'content',
  ];
  const allColumns = [...baseColumns, ...sortedMetaKeys.map((k) => `metadata_${k}`)];

  const csvEscape = (val: string): string => {
    if (val.includes(',') || val.includes('"') || val.includes('\n')) {
      return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
  };

  const lines: string[] = [allColumns.join(',')];

  for (const doc of filtered) {
    const baseValues = [
      doc.id,
      doc.title,
      doc.source,
      doc.url ?? '',
      String(doc.charCount),
      doc.status ?? 'unindexed',
      doc.createdAt,
      doc.content.slice(0, maxContentChars).replace(/\n/g, ' '),
    ];

    const metaValues = sortedMetaKeys.map((key) => {
      const val = doc.metadata?.[key];
      if (val === undefined || val === null) return '';
      if (typeof val === 'object') return JSON.stringify(val);
      return String(val);
    });

    lines.push([...baseValues, ...metaValues].map(csvEscape).join(','));
  }

  return lines.join('\n');
}

/**
 * Export the corpus as a JSONL string for sandbox injection.
 * Each line is a JSON object with all document fields + flattened metadata.
 */
export async function exportCorpusAsJSONL(
  filter?: CorpusFilter,
  maxContentChars = 1000,
): Promise<string> {
  const allDocs = await readDocuments();
  const filtered = applyFilters(allDocs, filter);

  return filtered
    .map((doc) => {
      const flat: Record<string, any> = {
        id: doc.id,
        title: doc.title,
        source: doc.source,
        url: doc.url ?? '',
        charCount: doc.charCount,
        status: doc.status ?? 'unindexed',
        createdAt: doc.createdAt,
        content: doc.content.slice(0, maxContentChars),
      };

      // Flatten non-internal metadata
      if (doc.metadata) {
        for (const [key, val] of Object.entries(doc.metadata)) {
          if (!key.startsWith('_')) {
            flat[`metadata_${key}`] = val;
          }
        }
      }

      return JSON.stringify(flat);
    })
    .join('\n');
}
