export type ChartType = 'bar' | 'area' | 'line' | 'pie' | 'scatter' | 'radar';

export interface SeriesConfig {
  dataKey: string;
  label?: string;
  color?: string;
}

export interface ChartConfig {
  chartType: ChartType;
  title: string;
  subtitle?: string;
  data: Record<string, unknown>[];
  xAxisKey: string;
  series: SeriesConfig[];
  colors?: string[];
  stacked?: boolean;
  showLegend?: boolean;
  xAxisLabel?: string;
  yAxisLabel?: string;
  /** A user-facing reason the supplied rows cannot be rendered honestly. */
  error?: string;
}

const CHART_TYPES = new Set<ChartType>(['bar', 'area', 'line', 'pie', 'scatter', 'radar']);
const PLACEHOLDER_NAME =
  /^(?:\s|_)*(?:empty|null|undefined|n\/?a|unknown)(?:\s*[_-]?\s*\d+)?(?:\s|_)*$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isUsableKey(value: unknown): value is string {
  return (
    typeof value === 'string' && value.trim().length > 0 && !PLACEHOLDER_NAME.test(value.trim())
  );
}

function keyIdentity(key: string) {
  return key.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function matchingKey(candidate: unknown, keys: string[]): string | undefined {
  if (!isUsableKey(candidate)) return undefined;
  if (keys.includes(candidate)) return candidate;
  const identity = keyIdentity(candidate);
  return keys.find((key) => keyIdentity(key) === identity);
}

export function numericValue(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;

  const source = value.trim();
  if (!source) return undefined;
  const normalized = source.replace(/[\s,]/g, '').replace(/[€£$¥%]/g, '');
  if (!/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized)) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function hasAxisValue(rows: Record<string, unknown>[], key: string) {
  return rows.some((row) => {
    const value = row[key];
    return (
      value !== null &&
      value !== undefined &&
      String(value).trim().length > 0 &&
      !(typeof value === 'string' && PLACEHOLDER_NAME.test(value.trim()))
    );
  });
}

function hasNumericValue(rows: Record<string, unknown>[], key: string) {
  return rows.some((row) => numericValue(row[key]) !== undefined);
}

export function formatChartLabel(key: string) {
  return key
    .replace(/^(sum|avg|count|min|max|median)_/i, '$1 ')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanText(value: unknown) {
  return isUsableKey(value) ? value.trim() : undefined;
}

/**
 * Normalizes untrusted model chart payloads without inventing data. Invalid
 * placeholder fields are dropped and ambiguous keys are inferred from real
 * rows only, so a bad tool call cannot create duplicate or "EMPTY" series.
 */
export function normalizeChartConfig(input: unknown): ChartConfig {
  const source = isRecord(input) ? input : {};
  const rawRows = Array.isArray(source.data) ? source.data.filter(isRecord) : [];
  const keys = [...new Set(rawRows.flatMap((row) => Object.keys(row)))].filter(isUsableKey);
  const chartType = CHART_TYPES.has(source.chartType as ChartType)
    ? (source.chartType as ChartType)
    : 'bar';
  const numericKeys = keys.filter((key) => hasNumericValue(rawRows, key));

  let xAxisKey = matchingKey(source.xAxisKey, keys);
  if (chartType === 'scatter') {
    if (!xAxisKey || !hasNumericValue(rawRows, xAxisKey)) xAxisKey = numericKeys[0];
  } else if (!xAxisKey || !hasAxisValue(rawRows, xAxisKey)) {
    xAxisKey =
      keys.find((key) => !hasNumericValue(rawRows, key) && hasAxisValue(rawRows, key)) ??
      keys.find((key) => hasAxisValue(rawRows, key));
  }
  // A model occasionally names the only measure as the X field. When there
  // is no remaining numeric series but a real category exists, that shape is
  // unambiguous: use the category as X rather than emit an empty chart.
  if (
    chartType !== 'scatter' &&
    xAxisKey &&
    hasNumericValue(rawRows, xAxisKey) &&
    !numericKeys.some((key) => key !== xAxisKey) &&
    keys.some(
      (key) => key !== xAxisKey && !hasNumericValue(rawRows, key) && hasAxisValue(rawRows, key),
    )
  ) {
    xAxisKey = keys.find(
      (key) => key !== xAxisKey && !hasNumericValue(rawRows, key) && hasAxisValue(rawRows, key),
    );
  }

  const rawSeries = Array.isArray(source.series) ? source.series.filter(isRecord) : [];
  const selectedSeries: SeriesConfig[] = [];
  const selectedKeys = new Set<string>();
  for (const candidate of rawSeries) {
    const dataKey = matchingKey(candidate.dataKey, numericKeys);
    if (!dataKey || dataKey === xAxisKey || selectedKeys.has(dataKey)) continue;
    const requestedLabel = cleanText(candidate.label);
    selectedKeys.add(dataKey);
    selectedSeries.push({
      dataKey,
      label: requestedLabel ?? formatChartLabel(dataKey),
      ...(cleanText(candidate.color) ? { color: cleanText(candidate.color) } : {}),
    });
  }

  if (selectedSeries.length === 0) {
    for (const dataKey of numericKeys) {
      if (dataKey === xAxisKey) continue;
      selectedKeys.add(dataKey);
      selectedSeries.push({ dataKey, label: formatChartLabel(dataKey) });
    }
  }
  if (chartType === 'pie' && selectedSeries.length > 1) selectedSeries.splice(1);

  const data = rawRows
    .map((row) => {
      const normalized: Record<string, unknown> = {};
      if (xAxisKey && row[xAxisKey] !== undefined && row[xAxisKey] !== null) {
        normalized[xAxisKey] = row[xAxisKey];
      }
      for (const series of selectedSeries) {
        const value = numericValue(row[series.dataKey]);
        if (value !== undefined) normalized[series.dataKey] = value;
      }
      return normalized;
    })
    .filter(
      (row) =>
        Boolean(xAxisKey && hasAxisValue([row], xAxisKey)) &&
        selectedSeries.some((series) => numericValue(row[series.dataKey]) !== undefined),
    );

  const title =
    cleanText(source.title) ??
    (xAxisKey && selectedSeries[0]
      ? `${selectedSeries[0].label ?? formatChartLabel(selectedSeries[0].dataKey)} by ${formatChartLabel(xAxisKey)}`
      : 'Data chart');
  const error =
    rawRows.length === 0
      ? 'No data was provided for this chart.'
      : !xAxisKey
        ? 'No usable category or X-axis field was provided.'
        : selectedSeries.length === 0
          ? 'No numeric data series was provided for this chart.'
          : data.length === 0
            ? 'The supplied rows do not contain plottable values.'
            : undefined;

  return {
    chartType,
    title,
    ...(cleanText(source.subtitle) ? { subtitle: cleanText(source.subtitle) } : {}),
    data,
    xAxisKey: xAxisKey ?? '',
    series: selectedSeries,
    ...(Array.isArray(source.colors)
      ? { colors: source.colors.filter((color): color is string => isUsableKey(color)) }
      : {}),
    ...(typeof source.stacked === 'boolean' ? { stacked: source.stacked } : {}),
    showLegend:
      typeof source.showLegend === 'boolean' ? source.showLegend : selectedSeries.length > 1,
    ...(cleanText(source.xAxisLabel) ? { xAxisLabel: cleanText(source.xAxisLabel) } : {}),
    ...(cleanText(source.yAxisLabel) ? { yAxisLabel: cleanText(source.yAxisLabel) } : {}),
    ...(error ? { error } : {}),
  };
}
