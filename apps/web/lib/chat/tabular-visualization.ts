import { formatChartLabel, normalizeChartConfig, numericValue } from './chart-config';

export type TabularChartConfig = {
  chartType: 'bar' | 'line';
  title: string;
  data: Record<string, unknown>[];
  xAxisKey: string;
  series: { dataKey: string; label: string }[];
  showLegend: boolean;
  xAxisLabel?: string;
  yAxisLabel?: string;
};

export function requestsVisualization(text: string): boolean {
  return /\b(chart|graph|plot|visuali[sz]e|distribution|breakdown|trends?|compare|show\s+me)\b/i.test(
    text,
  );
}

function normalizedTerms(value: string) {
  return value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function columnIsMentioned(text: string, column: string) {
  const requestTerms = new Set(normalizedTerms(text));
  const columnTerms = normalizedTerms(column).filter((term) => term.length >= 3);
  return columnTerms.some((term) => requestTerms.has(term));
}

function hasNumericValues(rows: Record<string, unknown>[], column: string) {
  return rows.some((row) => numericValue(row[column]) !== undefined);
}

function hasVaryingValues(rows: Record<string, unknown>[], column: string) {
  const values = new Set(
    rows
      .map((row) => row[column])
      .filter((value) => value !== null && value !== undefined && String(value).trim())
      .map((value) => String(value)),
  );
  return values.size > 1;
}

function isTemporalColumn(column: string, rows: Record<string, unknown>[]) {
  if (/\b(?:year|date|month|quarter|week|day|time)\b/i.test(formatChartLabel(column))) return true;
  return rows.some((row) => /^(?:19|20)\d{2}$/.test(String(row[column] ?? '').trim()));
}

/** Build a chart only from an already-queried, bounded tabular result. */
export function createTabularVisualization(
  requestText: string | undefined,
  result: { columns: string[]; rows: Record<string, unknown>[] },
): TabularChartConfig | undefined {
  if (!requestText || !requestsVisualization(requestText) || result.rows.length === 0) {
    return undefined;
  }

  const wantsTimeSeries =
    /\b(?:line(?:\s+\w+){0,2}\s+chart|trends?|over time|time series|year[ -]to[ -]year|available years?|monthly|quarterly|annually)\b/i.test(
      requestText,
    );
  const numericColumns = result.columns.filter((column) => hasNumericValues(result.rows, column));
  const temporalColumn = wantsTimeSeries
    ? result.columns.find(
        (column) => isTemporalColumn(column, result.rows) && hasVaryingValues(result.rows, column),
      )
    : undefined;
  const categoryColumn = result.columns.find(
    (column) =>
      !numericColumns.includes(column) &&
      hasVaryingValues(result.rows, column) &&
      !/^_*empty(?:[_-]?\d+)?$/i.test(column.trim()),
  );
  const xAxisKey = temporalColumn ?? categoryColumn ?? result.columns[0] ?? '';
  const seriesCandidates = numericColumns.filter((column) => column !== xAxisKey);
  const mentionedSeries = seriesCandidates.filter((column) =>
    columnIsMentioned(requestText, column),
  );
  const seriesColumns = (mentionedSeries.length > 0 ? mentionedSeries : seriesCandidates).slice(
    0,
    3,
  );
  const chartType = wantsTimeSeries ? 'line' : 'bar';

  const candidate = normalizeChartConfig({
    chartType,
    title: 'Data chart',
    data: result.rows.slice(0, 50),
    xAxisKey,
    series: seriesColumns.map((column) => ({ dataKey: column, label: column })),
  });
  if (candidate.error) return undefined;

  return {
    ...candidate,
    chartType: candidate.chartType as 'bar' | 'line',
    title: `${chartType === 'line' ? 'Trend' : 'Distribution'} by ${formatChartLabel(candidate.xAxisKey)}`,
    series: candidate.series.map((series) => ({
      ...series,
      label:
        !series.label || series.label === series.dataKey
          ? formatChartLabel(series.dataKey)
          : series.label,
    })),
    showLegend: candidate.showLegend ?? candidate.series.length > 1,
  };
}
