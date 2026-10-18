import type { TabularDataset, TabularQueryRequest } from '@larkup/core/tabular-store';

export type InferredTabularPlan = {
  request: TabularQueryRequest;
  chartTitle?: string;
};

function numericColumns(dataset: TabularDataset): string[] {
  return dataset.columns.filter((column) => column.type === 'number').map((column) => column.name);
}

function normalized(value: string) {
  return value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function columnMentioned(text: string, column: string) {
  const query = normalized(text);
  const name = normalized(column);
  if (!query || !name) return false;
  if (query.includes(name)) return true;
  const words = name.split(' ').filter(Boolean);
  return (
    words.length === 1 && words[0].length >= 4 && new RegExp(`\\b${words[0]}\\b`, 'iu').test(query)
  );
}

function explicitNumericMeasures(
  text: string,
  dataset: TabularDataset,
  request: TabularQueryRequest,
) {
  const numeric = numericColumns(dataset);
  const requested = (request.aggregations ?? [])
    .map((aggregation) => aggregation.column)
    .filter((column) => numeric.includes(column));
  const mentioned = numeric.filter((column) => columnMentioned(text, column));
  return [...new Set([...requested, ...mentioned])];
}

function columnPattern(column: string) {
  return normalized(column)
    .split(' ')
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[-_\\s]+');
}

function groupingColumn(text: string, dataset: TabularDataset) {
  return dataset.columns.find(
    (column) =>
      column.type !== 'number' &&
      new RegExp(`\\bby\\s+(?:the\\s+)?${columnPattern(column.name)}\\b`, 'iu').test(text),
  )?.name;
}

function requestedOperation(
  measure: string,
  request: TabularQueryRequest,
  text: string,
): NonNullable<TabularQueryRequest['aggregations']>[number]['op'] {
  const supplied = request.aggregations?.find((aggregation) => aggregation.column === measure)?.op;
  if (supplied) return supplied;
  if (/\b(?:average|avg|mean)\b/iu.test(text)) return 'avg';
  if (/\bmedian\b/iu.test(text)) return 'median';
  // “Lowest to highest” and “highest month” usually describe ordering or a
  // later comparison of grouped totals, not a request for the minimum raw
  // order-level value. Reserve min/max for an explicit aggregate operation.
  if (/\b(?:minimum|min)\b/iu.test(text)) return 'min';
  if (/\b(?:maximum|max)\b/iu.test(text)) return 'max';
  return 'sum';
}

function requestedSortOrder(text: string) {
  if (/\b(?:lowest\s+to\s+highest|ascending|asc)\b/iu.test(text)) return 'asc' as const;
  if (/\b(?:highest\s+to\s+lowest|descending|desc)\b/iu.test(text)) return 'desc' as const;
  return undefined;
}

function normalizeAggregations(
  dataset: TabularDataset,
  request: TabularQueryRequest,
): TabularQueryRequest {
  if (!request.aggregations?.length) return request;
  const numeric = numericColumns(dataset);
  const isCount = (aggregation: NonNullable<TabularQueryRequest['aggregations']>[number]) =>
    aggregation.op === 'count' || aggregation.op === 'countDistinct';
  const valid = request.aggregations.filter(
    (aggregation) => isCount(aggregation) || numeric.includes(aggregation.column),
  );
  if (valid.length === request.aggregations.length || numeric.length !== 1) return request;

  // The model may select a text label such as a representative/name as a
  // measure. A dataset with exactly one numeric field has an unambiguous,
  // schema-derived correction; otherwise leave the request unchanged.
  return {
    ...request,
    aggregations: request.aggregations.map((aggregation) =>
      isCount(aggregation) ? aggregation : { ...aggregation, column: numeric[0] },
    ),
  };
}

function normalizeDistinctCountIntent(
  text: string,
  request: TabularQueryRequest,
): TabularQueryRequest {
  if (!/\b(?:unique|distinct)\b/i.test(text) || !request.aggregations?.length) return request;

  return {
    ...request,
    aggregations: request.aggregations.map((aggregation) =>
      aggregation.op === 'count' ? { ...aggregation, op: 'countDistinct' } : aggregation,
    ),
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
  const requestedMeasures = explicitNumericMeasures(text, dataset, request);
  const measureColumns =
    requestedMeasures.length > 0 ? requestedMeasures : numeric.length === 1 ? [numeric[0]] : [];
  const year = text.match(/\b(20\d{2})\b/)?.[1];

  if (
    dateColumn &&
    measureColumns.length > 0 &&
    /\b(?:monthly|per month|month(?:ly)? trend)\b/i.test(text)
  ) {
    const bucketColumn = `${dateColumn}_month`;
    const filters = (request.filters ?? []).filter((filter) => filter.column !== dateColumn);
    if (year) {
      filters.push({ column: dateColumn, op: 'gte', value: `${year}-01-01` });
      filters.push({ column: dateColumn, op: 'lt', value: `${Number(year) + 1}-01-01` });
    }
    return {
      request: {
        ...request,
        // A model may also send the source column names. Once rows are
        // grouped those names no longer exist (for example, Revenue becomes
        // sum_Revenue), so retaining the projection would turn every result
        // row into an empty object.
        columns: undefined,
        filters,
        timeBucket: { column: dateColumn, grain: 'month' },
        groupBy: [bucketColumn],
        aggregations: measureColumns.map((column) => ({
          column,
          op: requestedOperation(column, request, text),
        })),
        sortBy: bucketColumn,
        sortOrder: 'asc',
        limit: 120,
      },
      chartTitle: `Monthly ${measureColumns.join(' and ')} trend${year ? ` for ${year}` : ''}`,
    };
  }

  const groupBy = groupingColumn(text, dataset);
  if (groupBy && requestedMeasures.length > 0) {
    const aggregations = requestedMeasures.map((column) => ({
      column,
      op: requestedOperation(column, request, text),
    }));
    const sortOrder = requestedSortOrder(text);
    return {
      request: {
        ...request,
        columns: undefined,
        groupBy: [groupBy],
        aggregations,
        ...(sortOrder
          ? { sortBy: `${aggregations[0].op}_${aggregations[0].column}`, sortOrder }
          : {}),
        limit: Math.min(request.limit ?? 120, 120),
      },
    };
  }

  return {
    request: normalizeDistinctCountIntent(text, normalizeAggregations(dataset, request)),
  };
}
