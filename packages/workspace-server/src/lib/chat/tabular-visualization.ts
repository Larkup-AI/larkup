import { formatChartLabel, normalizeChartConfig, numericValue } from '@larkup/core/chart-config';

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

type TabularVisualizationResult = {
  visualization?: TabularChartConfig;
  error?: unknown;
};

function formatChartCategory(value: string) {
  const calendarMonth = value.match(/^(\d{4})-(\d{2})$/);
  if (calendarMonth) {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(Number(calendarMonth[1]), Number(calendarMonth[2]) - 1, 1)));
  }
  return formatChartLabel(value);
}

function formatSeriesLabel(value: string) {
  return formatChartLabel(
    value.replace(/^(?:sum|avg|countDistinct|count|min|max|median)[_\s-]+/i, ''),
  );
}

export function requestsVisualization(text: string): boolean {
  const explicitChart =
    /\b(?:charts?|graphs?|plots?|visuali[sz](?:e|ation)|diagram|histogram|scatter\s*plot|trends?)\b/iu.test(
      text,
    );
  const visualPresentation =
    /\b(?:show|display|draw|render|create|make)\b.{0,40}\b(?:distribution|breakdown|trend|comparison)\b/iu.test(
      text,
    );
  return explicitChart || visualPresentation;
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
          ? formatSeriesLabel(series.dataKey)
          : series.label,
    })),
    showLegend: candidate.showLegend ?? candidate.series.length > 1,
  };
}

/**
 * Keep the prose beside a rendered chart compact and deterministic. The chart
 * already exposes every plotted row, so echoing those rows as assistant text
 * is both noisy and a common source of provider-specific output failures.
 */
export function formatTabularVisualizationAnswer(result: TabularVisualizationResult): string {
  const chart = result.visualization;
  if (!chart) {
    return typeof result.error === 'string' && result.error.trim()
      ? `I couldn’t create the requested chart: ${result.error.trim()}`
      : 'I couldn’t create a chart from the available tabular result.';
  }

  const insights = chart.series.flatMap((series) => {
    const points = chart.data.flatMap((row) => {
      const value = numericValue(row[series.dataKey]);
      const category = row[chart.xAxisKey];
      return value === undefined || category === undefined || category === null
        ? []
        : [{ value, category: String(category) }];
    });
    if (points.length < 2) return [];
    const peak = points.reduce((best, point) => (point.value > best.value ? point : best));
    return `${series.label || formatSeriesLabel(series.dataKey)} peaks at ${new Intl.NumberFormat(
      'en-US',
      { maximumFractionDigits: 2 },
    ).format(peak.value)} in ${formatChartCategory(peak.category)}`;
  });

  const introduction = chart.title?.trim()
    ? `Here’s the requested chart: ${chart.title.trim()}.`
    : 'Here’s the requested chart.';
  return insights.length > 0 ? `${introduction} ${insights.join('; ')}.` : introduction;
}
