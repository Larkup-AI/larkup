import { formatChartLabel, normalizeChartConfig } from './chart-config';

export type TabularChartConfig = {
  chartType: 'bar' | 'line';
  title: string;
  data: Record<string, unknown>[];
  xAxisKey: string;
  series: { dataKey: string; label: string }[];
  showLegend: boolean;
};

export function requestsVisualization(text: string): boolean {
  return /\b(chart|graph|plot|visuali[sz]e|distribution|breakdown|trends?|compare|show\s+me)\b/i.test(
    text,
  );
}

/** Build a chart only from an already-queried, bounded tabular result. */
export function createTabularVisualization(
  requestText: string | undefined,
  result: { columns: string[]; rows: Record<string, unknown>[] },
): TabularChartConfig | undefined {
  if (!requestText || !requestsVisualization(requestText) || result.rows.length === 0) {
    return undefined;
  }

  const candidate = normalizeChartConfig({
    chartType: /\b(?:line(?:\s+\w+){0,2}\s+chart|trends?|over time|time series)\b/i.test(
      requestText,
    )
      ? 'line'
      : 'bar',
    title: 'Data chart',
    data: result.rows.slice(0, 50),
    xAxisKey: result.columns[0] ?? '',
    series: result.columns.slice(1, 4).map((column) => ({ dataKey: column, label: column })),
  });
  if (candidate.error) return undefined;

  return {
    ...candidate,
    chartType: candidate.chartType as 'bar' | 'line',
    title: `Distribution by ${formatChartLabel(candidate.xAxisKey)}`,
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
