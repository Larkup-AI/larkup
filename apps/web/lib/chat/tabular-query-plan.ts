import type { TabularDataset, TabularQueryRequest } from '@larkup/core/tabular-store';

export type InferredTabularPlan = {
  request: TabularQueryRequest;
  chartTitle?: string;
};

function numericColumns(dataset: TabularDataset): string[] {
  return dataset.columns.filter((column) => column.type === 'number').map((column) => column.name);
}

function normalizeAggregations(
  dataset: TabularDataset,
  request: TabularQueryRequest,
): TabularQueryRequest {
  if (!request.aggregations?.length) return request;
  const numeric = numericColumns(dataset);
  const valid = request.aggregations.filter((aggregation) => numeric.includes(aggregation.column));
  if (valid.length === request.aggregations.length || numeric.length !== 1) return request;

  // The model may select a text label such as a representative/name as a
  // measure. A dataset with exactly one numeric field has an unambiguous,
  // schema-derived correction; otherwise leave the request unchanged.
  return {
    ...request,
    aggregations: request.aggregations.map((aggregation) => ({
      ...aggregation,
      column: numeric[0],
    })),
  };
}

/**
 * Normalize a clear calendar request from the dataset schema. It never
 * assumes business columns or domain names: a time series is derived only
 * when there is one date column and one numeric measure.
 */
export function inferTabularPlan(
  requestText: string | undefined,
  dataset: TabularDataset,
  request: TabularQueryRequest,
): InferredTabularPlan {
  const text = requestText?.toLocaleLowerCase() ?? '';
  const dateColumn = dataset.columns.find((column) => column.type === 'date')?.name;
  const numeric = numericColumns(dataset);
  const measureColumn = numeric.length === 1 ? numeric[0] : undefined;
  const year = text.match(/\b(20\d{2})\b/)?.[1];

  if (dateColumn && measureColumn && /\b(?:monthly|per month|month(?:ly)? trend)\b/i.test(text)) {
    const bucketColumn = `${dateColumn}_month`;
    const filters = (request.filters ?? []).filter((filter) => filter.column !== dateColumn);
    if (year) {
      filters.push({ column: dateColumn, op: 'gte', value: `${year}-01-01` });
      filters.push({ column: dateColumn, op: 'lt', value: `${Number(year) + 1}-01-01` });
    }
    return {
      request: {
        ...request,
        filters,
        timeBucket: { column: dateColumn, grain: 'month' },
        groupBy: [bucketColumn],
        aggregations: [{ column: measureColumn, op: 'sum' }],
        sortBy: bucketColumn,
        sortOrder: 'asc',
        limit: 120,
      },
      chartTitle: `Monthly ${measureColumn} trend${year ? ` for ${year}` : ''}`,
    };
  }

  return { request: normalizeAggregations(dataset, request) };
}
