import { describe, expect, it } from 'vitest';
import type { TabularDataset } from '@larkup/core/tabular-store';
import { inferTabularPlan } from './tabular-query-plan';

const dataset: TabularDataset = {
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
};

const superstoreOrders: TabularDataset = {
  ...dataset,
  id: 'superstore-orders',
  fileName: 'Superstore.xlsx — Orders',
  columns: [
    { name: 'Order Date', type: 'date', nullCount: 0, uniqueCount: 100 },
    { name: 'Sub-Category', type: 'string', nullCount: 0, uniqueCount: 17 },
    { name: 'Sales', type: 'number', nullCount: 0, uniqueCount: 100 },
    { name: 'Profit', type: 'number', nullCount: 0, uniqueCount: 100 },
    { name: 'Discount', type: 'number', nullCount: 0, uniqueCount: 15 },
  ],
  summary: {
    totalRows: 100,
    totalColumns: 5,
    numericColumns: 3,
    categoricalColumns: 1,
    dateColumns: 1,
  },
};

describe('inferTabularPlan', () => {
  it('turns a monthly 2025 request into a bounded grouped date query', () => {
    const plan = inferTabularPlan("What's the monthly revenue trend for 2025?", dataset, {
      datasetId: dataset.id,
      columns: ['Date', 'Net Revenue'],
    });

    expect(plan.request).toMatchObject({
      timeBucket: { column: 'Date', grain: 'month' },
      groupBy: ['Date_month'],
      aggregations: [{ column: 'Net Revenue', op: 'sum' }],
      sortBy: 'Date_month',
      sortOrder: 'asc',
      limit: 120,
    });
    expect(plan.request.filters).toEqual([
      { column: 'Date', op: 'gte', value: '2025-01-01' },
      { column: 'Date', op: 'lt', value: '2026-01-01' },
    ]);
    expect(plan.request.columns).toBeUndefined();
  });

  it('repairs an invalid text aggregation only when the schema has one numeric measure', () => {
    const plan = inferTabularPlan('show me distribution over sales by area', dataset, {
      datasetId: dataset.id,
      groupBy: ['Region'],
      aggregations: [{ column: 'Sales Rep', op: 'sum' }],
    });

    expect(plan.request).toMatchObject({
      groupBy: ['Region'],
      aggregations: [{ column: 'Net Revenue', op: 'sum' }],
    });
  });

  it('uses a distinct count for a natural-language unique-value request', () => {
    const plan = inferTabularPlan('How many unique sales reps are there?', dataset, {
      datasetId: dataset.id,
      aggregations: [{ column: 'Sales Rep', op: 'count' }],
    });

    expect(plan.request.aggregations).toEqual([{ column: 'Sales Rep', op: 'countDistinct' }]);
  });

  it('completes a monthly grouping when the model selected one measure from several', () => {
    const multiMeasureDataset: TabularDataset = {
      ...dataset,
      columns: [
        ...dataset.columns,
        { name: 'Quantity', type: 'number', nullCount: 0, uniqueCount: 20 },
      ],
      summary: { ...dataset.summary, numericColumns: 2, totalColumns: 5 },
    };

    const plan = inferTabularPlan('Show the monthly revenue trend for 2025', multiMeasureDataset, {
      datasetId: dataset.id,
      timeBucket: { column: 'Date', grain: 'month' },
      aggregations: [{ column: 'Net Revenue', op: 'sum' }],
      sortBy: 'Date',
    });

    expect(plan.request).toMatchObject({
      groupBy: ['Date_month'],
      aggregations: [{ column: 'Net Revenue', op: 'sum' }],
      sortBy: 'Date_month',
      sortOrder: 'asc',
    });
  });

  it('keeps every explicitly requested metric in a monthly trend', () => {
    const plan = inferTabularPlan('Show monthly Sales and Profit trends.', superstoreOrders, {
      datasetId: superstoreOrders.id,
      aggregations: [{ column: 'Sales', op: 'sum' }],
    });

    expect(plan.request).toMatchObject({
      timeBucket: { column: 'Order Date', grain: 'month' },
      groupBy: ['Order Date_month'],
      aggregations: [
        { column: 'Sales', op: 'sum' },
        { column: 'Profit', op: 'sum' },
      ],
      sortBy: 'Order Date_month',
      sortOrder: 'asc',
    });
  });

  it('derives a sorted grouped measure from an explicit by-column request', () => {
    const plan = inferTabularPlan(
      'Create a bar chart of Profit by Sub-Category, sorted from lowest to highest.',
      superstoreOrders,
      { datasetId: superstoreOrders.id, limit: 20 },
    );

    expect(plan.request).toMatchObject({
      groupBy: ['Sub-Category'],
      aggregations: [{ column: 'Profit', op: 'sum' }],
      sortBy: 'sum_Profit',
      sortOrder: 'asc',
      limit: 20,
    });
  });
});
