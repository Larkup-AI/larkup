import { describe, expect, it } from 'vitest';
import type { TabularDatasetMeta } from '@larkup/core/tabular-store';
import {
  resolveTabularDatasetForQuestion,
  selectTabularDatasetForAnalysis,
  selectTabularDatasetForQuestion,
} from './tabular-dataset-routing';

const datasets: TabularDatasetMeta[] = [
  {
    id: 'generic-sales',
    fileName: 'sample_sales_data.xlsx',
    rowCount: 500,
    columns: [
      { name: 'Date', type: 'date', nullCount: 0, uniqueCount: 365 },
      { name: 'Net Revenue', type: 'number', nullCount: 0, uniqueCount: 500 },
    ],
    summary: {
      totalRows: 500,
      totalColumns: 2,
      numericColumns: 1,
      categoricalColumns: 0,
      dateColumns: 1,
    },
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'superstore-orders',
    fileName: 'Sample - Superstore.xlsx — Orders',
    rowCount: 9994,
    columns: [
      { name: 'Order Date', type: 'date', nullCount: 0, uniqueCount: 1200 },
      { name: 'Sub-Category', type: 'string', nullCount: 0, uniqueCount: 17 },
      { name: 'Sales', type: 'number', nullCount: 0, uniqueCount: 9000 },
      { name: 'Profit', type: 'number', nullCount: 0, uniqueCount: 7000 },
      { name: 'Discount', type: 'number', nullCount: 0, uniqueCount: 15 },
    ],
    summary: {
      totalRows: 9994,
      totalColumns: 5,
      numericColumns: 3,
      categoricalColumns: 1,
      dateColumns: 1,
    },
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

describe('resolveTabularDatasetForQuestion', () => {
  it('corrects a plausible but schema-incompatible sales sheet selection', () => {
    expect(
      resolveTabularDatasetForQuestion(
        'Show monthly Sales and Profit trends.',
        datasets,
        'generic-sales',
      ),
    ).toBe('superstore-orders');
  });

  it('keeps the revenue sheet when its measure is the one the user asked for', () => {
    expect(
      resolveTabularDatasetForQuestion(
        'Show the monthly Net Revenue trend.',
        datasets,
        'generic-sales',
      ),
    ).toBe('generic-sales');
  });

  it('supplies the unambiguous source for a sandbox analysis with no dataset ID', () => {
    expect(
      selectTabularDatasetForQuestion(
        'Does Discount correlate with Profit? Run a correlation analysis.',
        datasets,
      ),
    ).toBe('superstore-orders');
  });

  it('does not stage an arbitrary sheet when multiple schemas do not match', () => {
    expect(
      selectTabularDatasetForQuestion('Run a statistical analysis.', datasets),
    ).toBeUndefined();
  });

  it('uses the exact filename in generated code when the model omits the dataset ID', () => {
    expect(
      selectTabularDatasetForAnalysis(
        'Analyze the participant list.',
        "data = pd.read_csv('Sample - Superstore.xlsx — Orders')",
        datasets,
      ),
    ).toBe('superstore-orders');
  });

  it('prefers the newest duplicate upload named in generated code', () => {
    expect(
      selectTabularDatasetForAnalysis(
        'Analyze the participant list.',
        "data = pd.read_csv('sample_sales_data.xlsx')",
        [datasets[0], { ...datasets[0], id: 'new-sales', createdAt: '2026-02-01T00:00:00.000Z' }],
      ),
    ).toBe('new-sales');
  });
});
