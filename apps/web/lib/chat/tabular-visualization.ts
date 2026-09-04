export type TabularChartConfig = {
  chartType: 'bar' | 'line';
  title: string;
  data: Record<string, unknown>[];
  xAxisKey: string;
  series: { dataKey: string; label: string }[];
  showLegend: boolean;
};

function isNumeric(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

export function requestsVisualization(text: string): boolean {
  return /\b(chart|graph|plot|visuali[sz]e|distribution|breakdown|trend|compare|show\s+me)\b/i.test(
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

  const numericColumns = result.columns.filter((column) =>
    result.rows.some((row) => isNumeric(row[column])),
  );
  const categoryColumn = result.columns.find((column) => !numericColumns.includes(column));
  if (!categoryColumn || numericColumns.length === 0) return undefined;

  return {
    chartType: /\b(trend|over time|time series)\b/i.test(requestText) ? 'line' : 'bar',
    title: `Distribution by ${categoryColumn}`,
    data: result.rows.slice(0, 50),
    xAxisKey: categoryColumn,
    series: numericColumns.slice(0, 3).map((column) => ({ dataKey: column, label: column })),
    showLegend: numericColumns.length > 1,
  };
}
