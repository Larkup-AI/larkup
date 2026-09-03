import { expect, test } from '@playwright/test';
import { compactToolContextForModel } from '../../../apps/web/lib/chat/tool-context';
import {
  createTabularVisualization,
  requestsVisualization,
} from '../../../apps/web/lib/chat/tabular-visualization';
import { inferTabularPlan } from '../../../apps/web/lib/chat/tabular-query-plan';
import { hasRetrievedPdfEvidence } from '../../../apps/web/lib/chat/visual-routing';

test('bounds retrieved source payloads before the next model step', () => {
  const compacted = compactToolContextForModel([
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolName: 'searchKnowledgeBase',
          output: {
            type: 'json',
            value: {
              query: 'views under Resources',
              hits: Array.from({ length: 8 }, (_, index) => ({
                documentId: String(index),
                title: `Source ${index}`,
                text: 'x'.repeat(5_000),
                metadata: { images: Array.from({ length: 10 }, () => ({ description: 'large' })) },
              })),
            },
          },
        },
      ],
    },
  ]);

  const value = compacted[0].content[0].output.value;
  expect(value.hits).toHaveLength(4);
  expect(value.hits[0].text).toHaveLength(1_200);
  expect(value.hits[0].metadata).not.toHaveProperty('images');
});

test('creates a chart from a queried grouped result without another model tool call', () => {
  expect(requestsVisualization('show me distribution over sales by area')).toBe(true);
  expect(
    createTabularVisualization('show me distribution over sales by area', {
      columns: ['Region', 'sum_Net Revenue'],
      rows: [
        { Region: 'East', 'sum_Net Revenue': 535_384.44 },
        { Region: 'North', 'sum_Net Revenue': 717_478.74 },
      ],
    }),
  ).toMatchObject({
    chartType: 'bar',
    xAxisKey: 'Region',
    series: [{ dataKey: 'sum_Net Revenue' }],
  });
});

test('plans the CSV demo questions as bounded table queries', () => {
  const dataset = {
    id: 'sales-data',
    fileName: 'sales.csv',
    columns: [
      { name: 'Date', type: 'date', nullCount: 0, uniqueCount: 364 },
      { name: 'Region', type: 'string', nullCount: 0, uniqueCount: 4 },
      { name: 'Sales Rep', type: 'string', nullCount: 0, uniqueCount: 12 },
      { name: 'Net Revenue', type: 'number', nullCount: 0, uniqueCount: 364 },
    ],
    rows: [],
    summary: {
      totalRows: 364,
      totalColumns: 4,
      numericColumns: 1,
      categoricalColumns: 2,
      dateColumns: 1,
    },
    rowCount: 364,
    createdAt: '2025-01-01T00:00:00.000Z',
  } as const;

  const monthly = inferTabularPlan("What's the monthly revenue trend for 2025?", dataset as any, {
    datasetId: dataset.id,
  });
  expect(monthly.request).toMatchObject({
    timeBucket: { column: 'Date', grain: 'month' },
    groupBy: ['Date_month'],
    aggregations: [{ column: 'Net Revenue', op: 'sum' }],
  });

  const distribution = inferTabularPlan('show me distribution over sales by area', dataset as any, {
    datasetId: dataset.id,
    groupBy: ['Region'],
    aggregations: [{ column: 'Sales Rep', op: 'sum' }],
  });
  expect(distribution.request).toMatchObject({
    groupBy: ['Region'],
    aggregations: [{ column: 'Net Revenue', op: 'sum' }],
  });
});

test('routes a PDF retrieval to live local page inspection even without indexed images', () => {
  expect(
    hasRetrievedPdfEvidence({
      hits: [{ documentId: 'pdf-1', title: 'source.pdf', url: '/api/uploads/source.pdf' }],
    }),
  ).toBe(true);
});
