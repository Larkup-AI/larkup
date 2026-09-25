'use client';

import { useState, useRef, useCallback, useMemo } from 'react';
import {
  BarChart,
  Bar,
  AreaChart,
  Area,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  ScatterChart,
  Scatter,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { Download, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { normalizeChartConfig, type ChartConfig, type SeriesConfig } from '@/lib/chat/chart-config';

const CHART_COLORS = [
  '#10b981', // green (emerald)
  '#f97316', // orange
  '#3b82f6', // blue
  '#22c55e', // green
  '#f59e0b', // amber/orange
  '#0ea5e9', // sky blue
  '#84cc16', // lime green
  '#ea580c', // dark orange
  '#2563eb', // dark blue
];

/* Gradient definitions for area / bar fills */
function ChartGradients({ series }: { series: SeriesConfig[] }) {
  return (
    <defs>
      {series.map((s, i) => {
        const color = s.color || CHART_COLORS[i % CHART_COLORS.length];
        return (
          <linearGradient key={s.dataKey} id={`gradient-${s.dataKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.25} />
            <stop offset="95%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        );
      })}
    </defs>
  );
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="rounded-lg border border-border/40 bg-card px-3 py-2.5 backdrop-blur-sm">
      <p className="mb-1.5 text-xs font-medium text-foreground">{label}</p>
      <div className="flex flex-col gap-1">
        {payload.map((entry: any, i: number) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-muted-foreground">{entry.name || entry.dataKey}:</span>
            <span className="font-medium tabular-nums text-foreground">
              {typeof entry.value === 'number'
                ? entry.value.toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })
                : entry.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export type { ChartConfig } from '@/lib/chat/chart-config';

function downloadCSV(data: Record<string, any>[], title: string) {
  if (data.length === 0) return;
  const keys = Object.keys(data[0]);
  const csv = [
    keys.join(','),
    ...data.map((row) =>
      keys
        .map((k) => {
          const v = String(row[k] ?? '');
          return v.includes(',') ? `"${v}"` : v;
        })
        .join(','),
    ),
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title.replace(/\s+/g, '_').toLowerCase()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function copyDataToClipboard(data: Record<string, any>[]) {
  if (data.length === 0) return;
  const keys = Object.keys(data[0]);
  const text = [
    keys.join('\t'),
    ...data.map((row) => keys.map((k) => String(row[k] ?? '')).join('\t')),
  ].join('\n');
  navigator.clipboard.writeText(text);
}

const AXIS_TICK_STYLE = {
  fontSize: 11,
  fill: 'var(--muted-foreground)',
  fontFamily: 'inherit',
};

const AXIS_LINE_STYLE = {
  stroke: 'var(--border)',
};

const LEGEND_WRAPPER_STYLE = { fontSize: 11, paddingTop: 32 };
const LEGEND_WRAPPER_STYLE_PIE = { fontSize: 11 };
const PIE_LABEL_LINE = { stroke: 'var(--muted-foreground)', strokeWidth: 1 };
const SCATTER_CURSOR = { strokeDasharray: '3 3' };
const POLAR_ANGLE_TICK = { fontSize: 11, fill: 'var(--muted-foreground)' };
const POLAR_RADIUS_TICK = { fontSize: 10, fill: 'var(--muted-foreground)' };
const ACTIVE_DOT = { r: 4, strokeWidth: 2, stroke: 'var(--card)' };
const BAR_RADIUS: [number, number, number, number] = [4, 4, 0, 0];
const CARTESIAN_CHART_MARGIN = { top: 8, right: 16, bottom: 18, left: 36 };
const X_AXIS_HEIGHT = 72;
const Y_AXIS_WIDTH = 76;
const AXIS_TICK_MARGIN = 10;
const X_AXIS_MIN_TICK_GAP = 24;
const X_AXIS_LABEL_OFFSET = -8;
const Y_AXIS_LABEL_OFFSET = -20;

const renderPieLabel = ({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`;

function useDeepMemo<T>(factory: () => T, deps: any[]): T {
  const ref = useRef<{ deps: any[]; value: T } | null>(null);

  const depsStr = JSON.stringify(deps);

  if (ref.current === null || JSON.stringify(ref.current.deps) !== depsStr) {
    ref.current = { deps: JSON.parse(depsStr), value: factory() };
  }

  return ref.current.value;
}

export function ChatChart({ config }: { config: ChartConfig }) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  // Tool outputs are model-generated and historic conversations may contain
  // older payload shapes. Normalize immediately before rendering as a final
  // defensive boundary.
  const normalizedConfig = useMemo(() => normalizeChartConfig(config), [config]);
  const {
    chartType,
    title,
    subtitle,
    data,
    xAxisKey,
    series,
    colors,
    stacked,
    showLegend = true,
    xAxisLabel,
    yAxisLabel,
  } = normalizedConfig;

  const stableData = data;
  const stableSeries = series;
  const stableXAxisKey = xAxisKey;

  const chartColors = useDeepMemo(() => {
    const palette = colors && colors.length > 0 ? colors : CHART_COLORS;
    return stableSeries.map((s, i) => s.color || palette[i % palette.length]);
  }, [stableSeries, colors]);

  const pieColors = useDeepMemo(() => {
    return colors && colors.length > 0 ? colors : CHART_COLORS;
  }, [colors]);

  const chartDots = useDeepMemo(() => {
    return chartColors.map((color) => ({ r: 3, fill: color }));
  }, [chartColors]);

  const handleCopy = useCallback(() => {
    copyDataToClipboard(stableData);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [stableData]);

  const handleDownload = useCallback(() => downloadCSV(stableData, title), [stableData, title]);

  // Memoize axis labels stably
  const xLabelObj = useDeepMemo(
    () =>
      xAxisLabel
        ? {
            value: xAxisLabel,
            position: 'insideBottom',
            offset: X_AXIS_LABEL_OFFSET,
            style: { fontSize: 11, fill: 'var(--muted-foreground)' },
          }
        : undefined,
    [xAxisLabel],
  );

  const yLabelObj = useDeepMemo(
    () =>
      yAxisLabel
        ? {
            value: yAxisLabel,
            angle: -90,
            position: 'insideLeft',
            offset: Y_AXIS_LABEL_OFFSET,
            style: { fontSize: 11, fill: 'var(--muted-foreground)' },
          }
        : undefined,
    [yAxisLabel],
  );

  const renderChart = () => {
    switch (chartType) {
      case 'bar':
        return (
          <BarChart
            data={stableData}
            barGap={4}
            barCategoryGap="20%"
            margin={CARTESIAN_CHART_MARGIN}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--border)"
              opacity={0.4}
              vertical={false}
            />
            <XAxis
              dataKey={stableXAxisKey}
              tick={AXIS_TICK_STYLE}
              axisLine={AXIS_LINE_STYLE}
              tickLine={false}
              tickMargin={AXIS_TICK_MARGIN}
              minTickGap={X_AXIS_MIN_TICK_GAP}
              height={X_AXIS_HEIGHT}
              label={xLabelObj as any}
            />
            <YAxis
              tick={AXIS_TICK_STYLE}
              axisLine={false}
              tickLine={false}
              tickMargin={AXIS_TICK_MARGIN}
              width={Y_AXIS_WIDTH}
              label={yLabelObj as any}
            />
            <Tooltip content={CustomTooltip} cursor={false} />
            {showLegend && (
              <Legend iconType="circle" iconSize={7} wrapperStyle={LEGEND_WRAPPER_STYLE} />
            )}
            {stableSeries.map((s, i) => (
              <Bar
                key={s.dataKey}
                dataKey={s.dataKey}
                name={s.label || s.dataKey}
                fill={chartColors[i]}
                stackId={stacked ? 'stack' : undefined}
                radius={BAR_RADIUS as any}
                maxBarSize={40}
                animationDuration={700}
                animationEasing="ease-in-out"
              />
            ))}
          </BarChart>
        );

      case 'area':
        return (
          <AreaChart data={stableData} margin={CARTESIAN_CHART_MARGIN}>
            <ChartGradients series={stableSeries} />
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--border)"
              opacity={0.4}
              vertical={false}
            />
            <XAxis
              dataKey={stableXAxisKey}
              tick={AXIS_TICK_STYLE}
              axisLine={AXIS_LINE_STYLE}
              tickLine={false}
              tickMargin={AXIS_TICK_MARGIN}
              minTickGap={X_AXIS_MIN_TICK_GAP}
              height={X_AXIS_HEIGHT}
              label={xLabelObj as any}
            />
            <YAxis
              tick={AXIS_TICK_STYLE}
              axisLine={false}
              tickLine={false}
              tickMargin={AXIS_TICK_MARGIN}
              width={Y_AXIS_WIDTH}
              label={yLabelObj as any}
            />
            <Tooltip content={CustomTooltip} />
            {showLegend && (
              <Legend iconType="circle" iconSize={7} wrapperStyle={LEGEND_WRAPPER_STYLE} />
            )}
            {stableSeries.map((s, i) => (
              <Area
                key={s.dataKey}
                type="monotone"
                dataKey={s.dataKey}
                name={s.label || s.dataKey}
                stroke={chartColors[i]}
                strokeWidth={2}
                fill={`url(#gradient-${s.dataKey})`}
                stackId={stacked ? 'stack' : undefined}
                animationDuration={800}
                animationEasing="ease-in-out"
              />
            ))}
          </AreaChart>
        );

      case 'line':
        return (
          <LineChart data={stableData} margin={CARTESIAN_CHART_MARGIN}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--border)"
              opacity={0.4}
              vertical={false}
            />
            <XAxis
              dataKey={stableXAxisKey}
              tick={AXIS_TICK_STYLE}
              axisLine={AXIS_LINE_STYLE}
              tickLine={false}
              tickMargin={AXIS_TICK_MARGIN}
              minTickGap={X_AXIS_MIN_TICK_GAP}
              height={X_AXIS_HEIGHT}
              label={xLabelObj as any}
            />
            <YAxis
              tick={AXIS_TICK_STYLE}
              axisLine={false}
              tickLine={false}
              tickMargin={AXIS_TICK_MARGIN}
              width={Y_AXIS_WIDTH}
              label={yLabelObj as any}
            />
            <Tooltip content={CustomTooltip} />
            {showLegend && (
              <Legend iconType="circle" iconSize={7} wrapperStyle={LEGEND_WRAPPER_STYLE} />
            )}
            {stableSeries.map((s, i) => (
              <Line
                key={s.dataKey}
                type="monotone"
                dataKey={s.dataKey}
                name={s.label || s.dataKey}
                stroke={chartColors[i]}
                strokeWidth={2}
                dot={chartDots[i]}
                activeDot={ACTIVE_DOT}
                animationDuration={800}
                animationEasing="ease-in-out"
              />
            ))}
          </LineChart>
        );

      case 'pie': {
        const dataKey = stableSeries[0]?.dataKey || 'value';
        return (
          <PieChart>
            <Tooltip content={CustomTooltip} />
            <Pie
              data={stableData}
              dataKey={dataKey}
              nameKey={stableXAxisKey}
              cx="50%"
              cy="50%"
              outerRadius="75%"
              innerRadius="48%"
              paddingAngle={2}
              animationDuration={700}
              animationEasing="ease-in-out"
              label={renderPieLabel}
              labelLine={PIE_LABEL_LINE}
            >
              {stableData.map((entry, i) => (
                <Cell
                  key={`cell-${i}`}
                  fill={pieColors[i % pieColors.length]}
                  stroke="var(--card)"
                  strokeWidth={2}
                />
              ))}
            </Pie>
            {showLegend && (
              <Legend iconType="circle" iconSize={7} wrapperStyle={LEGEND_WRAPPER_STYLE_PIE} />
            )}
          </PieChart>
        );
      }

      case 'scatter':
        return (
          <ScatterChart margin={CARTESIAN_CHART_MARGIN}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--border)"
              opacity={0.4}
              vertical={false}
            />
            <XAxis
              dataKey={stableXAxisKey}
              type="number"
              tick={AXIS_TICK_STYLE}
              axisLine={AXIS_LINE_STYLE}
              tickLine={false}
              tickMargin={AXIS_TICK_MARGIN}
              minTickGap={X_AXIS_MIN_TICK_GAP}
              height={X_AXIS_HEIGHT}
              name={xAxisLabel || stableXAxisKey}
              label={xLabelObj as any}
            />
            <YAxis
              dataKey={stableSeries[0]?.dataKey}
              type="number"
              tick={AXIS_TICK_STYLE}
              axisLine={false}
              tickLine={false}
              tickMargin={AXIS_TICK_MARGIN}
              width={Y_AXIS_WIDTH}
              name={yAxisLabel || stableSeries[0]?.label || stableSeries[0]?.dataKey}
              label={yLabelObj as any}
            />
            <Tooltip content={CustomTooltip} cursor={SCATTER_CURSOR} />
            <Scatter
              name={stableSeries[0]?.label || stableSeries[0]?.dataKey}
              data={stableData}
              fill={chartColors[0]}
              animationDuration={700}
              animationEasing="ease-in-out"
            />
          </ScatterChart>
        );

      case 'radar':
        return (
          <RadarChart data={stableData} outerRadius="75%">
            <PolarGrid stroke="var(--border)" opacity={0.5} />
            <PolarAngleAxis dataKey={stableXAxisKey} tick={POLAR_ANGLE_TICK} />
            <PolarRadiusAxis tick={POLAR_RADIUS_TICK} />
            <Tooltip content={CustomTooltip} />
            {stableSeries.map((s, i) => (
              <Radar
                key={s.dataKey}
                dataKey={s.dataKey}
                name={s.label || s.dataKey}
                stroke={chartColors[i]}
                fill={chartColors[i]}
                fillOpacity={0.12}
                strokeWidth={2}
                animationDuration={700}
                animationEasing="ease-in-out"
              />
            ))}
            {showLegend && (
              <Legend iconType="circle" iconSize={7} wrapperStyle={LEGEND_WRAPPER_STYLE_PIE} />
            )}
          </RadarChart>
        );

      default:
        return null;
    }
  };

  if (normalizedConfig.error) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center border border-border/70 rounded-xl my-4 bg-transparent text-muted-foreground">
        <p className="text-sm">This chart could not be prepared</p>
        <p className="text-xs opacity-70 mt-1">{normalizedConfig.error}</p>
      </div>
    );
  }

  return (
    <div
      ref={chartRef}
      className="overflow-hidden rounded-xl border border-border/70 bg-muted my-4 animate-in fade-in duration-300 [&_*:focus]:outline-none [&_*:focus-visible]:outline-none [&_*:focus-visible]:ring-0"
    >
      {/* Header */}
      <div className="flex flex-row justify-between items-center gap-4 border-b border-border/30 px-4 py-3">
        <div className="flex flex-col justify-center min-w-0">
          <h3 className="text-sm font-semibold text-foreground truncate">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-muted-foreground truncate">{subtitle}</p>}
        </div>
      </div>

      <div className="px-2 py-4 pb-2">
        <div style={{ width: '100%', height: 340, minHeight: 340 }}>
          <ResponsiveContainer width="100%" height="100%" debounce={50}>
            {renderChart() as any}
          </ResponsiveContainer>
        </div>
      </div>

      {/* Footer actions */}
      <div className="flex flex-wrap items-center justify-start gap-2 border-t border-border/30 px-4 py-2.5">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-[11px] text-muted-foreground hover:text-foreground focus:ring-0 focus-visible:ring-0"
          onClick={handleCopy}
        >
          {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy Data'}
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-[11px] text-muted-foreground hover:text-foreground focus:ring-0 focus-visible:ring-0"
          onClick={handleDownload}
        >
          <Download className="h-3 w-3" />
          CSV
        </Button>
      </div>
    </div>
  );
}
