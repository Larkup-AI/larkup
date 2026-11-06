import assert from 'node:assert/strict';
import test from 'node:test';
import type { TabularDataset } from '@larkup/core/tabular-store';
import {
  analysisPresentationEvidence,
  normalizeAnalysisPresentationForRequest,
} from '../src/lib/chat/analysis-presentation.ts';

test('exposes every document page as compact final-answer evidence', () => {
  const evidence = analysisPresentationEvidence({
    kind: 'document',
    title: 'Dashboard',
    pages: [
      { content: 'Total Subjects: 900' },
      { content: 'Dropout Rate: placebo 11.333333, treatment 8.444444' },
    ],
    totalItems: 2,
    complete: true,
  });
  assert.match(evidence, /Total Subjects: 900/);
  assert.match(evidence, /placebo 11\.333333, treatment 8\.444444/);
});

test('adds requested dimension names and rounds displayed percentages', () => {
  const dataset = {
    id: 'stores',
    fileName: 'stores.csv',
    columns: ['store_id', 'store_name'].map((name) => ({
      name,
      type: 'string' as const,
      nullCount: 0,
      uniqueCount: 2,
    })),
    rows: [
      { store_id: 1, store_name: 'North' },
      { store_id: 2, store_name: 'South' },
    ],
    summary: {
      totalRows: 2,
      totalColumns: 2,
      numericColumns: 0,
      categoricalColumns: 2,
      dateColumns: 0,
    },
    rowCount: 2,
    createdAt: '2026-11-06T00:00:00.000Z',
  } satisfies TabularDataset;
  const normalized = normalizeAnalysisPresentationForRequest(
    'Which stores have the highest missed percentage?',
    {
      kind: 'table',
      title: 'Stores',
      columns: ['store_id', 'missed_percentage'],
      rows: [{ store_id: 2, missed_percentage: 5.9633 }],
      totalItems: 1,
      complete: true,
    },
    [dataset],
  );
  assert.equal(normalized?.kind, 'table');
  if (normalized?.kind !== 'table') return;
  assert.deepEqual(normalized.columns, ['store_id', 'store_name', 'missed_percentage']);
  assert.deepEqual(normalized.rows, [{ store_id: 2, store_name: 'South', missed_percentage: 6 }]);
});

test('does not add an unrequested or ambiguous dimension label', () => {
  const presentation = {
    kind: 'table' as const,
    title: 'Counts',
    columns: ['store_id', 'count'],
    rows: [{ store_id: 1, count: 2 }],
    totalItems: 1,
    complete: true,
  };
  assert.deepEqual(
    normalizeAnalysisPresentationForRequest('Show the counts.', presentation, []),
    presentation,
  );
});
