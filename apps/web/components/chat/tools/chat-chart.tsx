"use client";

import { useState, useMemo, useRef, useCallback, useEffect } from "react";
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
} from "recharts";
import { Download, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

/* ------------------------------------------------------------------ */
/* Color palette — refined, premium tones                              */
/* ------------------------------------------------------------------ */

const CHART_COLORS = [
  "#f97316", // orange
  "#10b981", // emerald
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#f43f5e", // rose
  "#f59e0b", // amber
  "#06b6d4", // cyan
  "#64748b", // slate
  "#ec4899", // pink
  "#14b8a6", // teal
];

/* Gradient definitions for area / bar fills */
function ChartGradients({ series }: { series: SeriesConfig[] }) {
  return (
    <defs>
      {series.map((s, i) => {
        const color = s.color || CHART_COLORS[i % CHART_COLORS.length];
        return (
          <linearGradient
            key={s.dataKey}
            id={`gradient-${s.dataKey}`}
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop offset="5%" stopColor={color} stopOpacity={0.25} />
            <stop offset="95%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        );
      })}
    </defs>
  );
}

/* ------------------------------------------------------------------ */
/* Custom tooltip — clean, minimal                                     */
/* ------------------------------------------------------------------ */

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
            <span className="text-muted-foreground">
              {entry.name || entry.dataKey}:
            </span>
            <span className="font-medium tabular-nums text-foreground">
              {typeof entry.value === "number"
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

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface SeriesConfig {
  dataKey: string;
  label?: string;
  color?: string;
}

export interface ChartConfig {
  chartType: "bar" | "area" | "line" | "pie" | "scatter" | "radar";
  title: string;
  subtitle?: string;
  data: Record<string, any>[];
  xAxisKey: string;
  series: SeriesConfig[];
  stacked?: boolean;
  showLegend?: boolean;
  xAxisLabel?: string;
  yAxisLabel?: string;
}

function downloadCSV(data: Record<string, any>[], title: string) {
  if (data.length === 0) return;
  const keys = Object.keys(data[0]);
  const csv = [
    keys.join(","),
    ...data.map((row) =>
      keys
        .map((k) => {
          const v = String(row[k] ?? "");
          return v.includes(",") ? `"${v}"` : v;
        })
        .join(","),
    ),
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${title.replace(/\s+/g, "_").toLowerCase()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function copyDataToClipboard(data: Record<string, any>[]) {
  if (data.length === 0) return;
  const keys = Object.keys(data[0]);
  const text = [
    keys.join("\t"),
    ...data.map((row) => keys.map((k) => String(row[k] ?? "")).join("\t")),
  ].join("\n");
  navigator.clipboard.writeText(text);
}

/* ------------------------------------------------------------------ */
/* Stable style objects — declared outside component to prevent        */
/* Recharts infinite re-render loops                                   */
/* ------------------------------------------------------------------ */

const AXIS_TICK_STYLE = {
  fontSize: 11,
  fill: "var(--muted-foreground)",
  fontFamily: "inherit",
};

const AXIS_LINE_STYLE = {
  stroke: "var(--border)",
};

const LEGEND_WRAPPER_STYLE = { fontSize: 11, paddingTop: 8 };
const LEGEND_WRAPPER_STYLE_PIE = { fontSize: 11 };
const PIE_LABEL_LINE = { stroke: "var(--muted-foreground)", strokeWidth: 1 };
const SCATTER_CURSOR = { strokeDasharray: "3 3" };
const POLAR_ANGLE_TICK = { fontSize: 11, fill: "var(--muted-foreground)" };
const POLAR_RADIUS_TICK = { fontSize: 10, fill: "var(--muted-foreground)" };
const ACTIVE_DOT = { r: 4, strokeWidth: 2, stroke: "var(--card)" };

const renderPieLabel = ({ name, percent }: any) =>
  `${name} ${(percent * 100).toFixed(0)}%`;

/* ------------------------------------------------------------------ */
/* Deep compare hook — prevents infinite loops from object references  */
/* ------------------------------------------------------------------ */

function useDeepMemo<T>(factory: () => T, deps: any[]): T {
  const ref = useRef<{ deps: any[]; value: T } | null>(null);

  const depsStr = JSON.stringify(deps);

  if (ref.current === null || ref.current.deps.toString() !== depsStr) {
    ref.current = { deps: JSON.parse(depsStr), value: factory() };
  }

  return ref.current.value;
}

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export function ChatChart({ config }: { config: ChartConfig }) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const {
    chartType,
    title,
    subtitle,
    data,
    xAxisKey,
    series,
    stacked,
    showLegend = true,
    xAxisLabel,
    yAxisLabel,
  } = config;

  // Stable memoized colors — deep compare series to avoid infinite loop
  const chartColors = useDeepMemo(
    () =>
      series.map((s, i) => s.color || CHART_COLORS[i % CHART_COLORS.length]),
    [series],
  );

  const chartDots = useDeepMemo(() => {
    return chartColors.map((color) => ({ r: 3, fill: color }));
  }, [chartColors]);

  const handleCopy = useCallback(() => {
    copyDataToClipboard(data);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [data]);

  const handleDownload = useCallback(
    () => downloadCSV(data, title),
    [data, title],
  );

  // Memoize axis labels stably
  const xLabelObj = useDeepMemo(
    () =>
      xAxisLabel
        ? {
            value: xAxisLabel,
            position: "insideBottom",
            offset: -5,
            style: { fontSize: 11, fill: "var(--muted-foreground)" },
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
            position: "insideLeft",
            style: { fontSize: 11, fill: "var(--muted-foreground)" },
          }
        : undefined,
    [yAxisLabel],
  );

  // Stable memoized series config for rendering
  const stableSeries = useDeepMemo(() => series, [series]);

  const renderChart = () => {
    switch (chartType) {
      case "bar":
        return (
          <BarChart data={data} barGap={4} barCategoryGap="20%">
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--border)"
              opacity={0.4}
              vertical={false}
            />
            <XAxis
              dataKey={xAxisKey}
              tick={AXIS_TICK_STYLE}
              axisLine={AXIS_LINE_STYLE}
              tickLine={false}
              label={xLabelObj as any}
            />
            <YAxis
              tick={AXIS_TICK_STYLE}
              axisLine={false}
              tickLine={false}
              label={yLabelObj as any}
            />
            <Tooltip content={CustomTooltip} cursor={false} />
            {showLegend && (
              <Legend
                iconType="circle"
                iconSize={7}
                wrapperStyle={LEGEND_WRAPPER_STYLE}
              />
            )}
            {stableSeries.map((s, i) => (
              <Bar
                key={s.dataKey}
                dataKey={s.dataKey}
                name={s.label || s.dataKey}
                fill={chartColors[i]}
                stackId={stacked ? "stack" : undefined}
                radius={[4, 4, 0, 0]}
                maxBarSize={40}
                animationDuration={700}
                animationEasing="ease-in-out"
              />
            ))}
          </BarChart>
        );

      case "area":
        return (
          <AreaChart data={data}>
            <ChartGradients series={stableSeries} />
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--border)"
              opacity={0.4}
              vertical={false}
            />
            <XAxis
              dataKey={xAxisKey}
              tick={AXIS_TICK_STYLE}
              axisLine={AXIS_LINE_STYLE}
              tickLine={false}
              label={xLabelObj as any}
            />
            <YAxis tick={AXIS_TICK_STYLE} axisLine={false} tickLine={false} />
            <Tooltip content={CustomTooltip} />
            {showLegend && (
              <Legend
                iconType="circle"
                iconSize={7}
                wrapperStyle={LEGEND_WRAPPER_STYLE}
              />
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
                stackId={stacked ? "stack" : undefined}
                animationDuration={800}
                animationEasing="ease-in-out"
              />
            ))}
          </AreaChart>
        );

      case "line":
        return (
          <LineChart data={data}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--border)"
              opacity={0.4}
              vertical={false}
            />
            <XAxis
              dataKey={xAxisKey}
              tick={AXIS_TICK_STYLE}
              axisLine={AXIS_LINE_STYLE}
              tickLine={false}
              label={xLabelObj as any}
            />
            <YAxis tick={AXIS_TICK_STYLE} axisLine={false} tickLine={false} />
            <Tooltip content={CustomTooltip} />
            {showLegend && (
              <Legend
                iconType="circle"
                iconSize={7}
                wrapperStyle={LEGEND_WRAPPER_STYLE}
              />
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

      case "pie": {
        const dataKey = stableSeries[0]?.dataKey || "value";
        return (
          <PieChart>
            <Tooltip content={CustomTooltip} />
            <Pie
              data={data}
              dataKey={dataKey}
              nameKey={xAxisKey}
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
              {data.map((entry, i) => (
                <Cell
                  key={`cell-${i}`}
                  fill={chartColors[i % chartColors.length]}
                  stroke="var(--card)"
                  strokeWidth={2}
                />
              ))}
            </Pie>
            {showLegend && (
              <Legend
                iconType="circle"
                iconSize={7}
                wrapperStyle={LEGEND_WRAPPER_STYLE_PIE}
              />
            )}
          </PieChart>
        );
      }

      case "scatter":
        return (
          <ScatterChart>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--border)"
              opacity={0.4}
              vertical={false}
            />
            <XAxis
              dataKey={xAxisKey}
              type="number"
              tick={AXIS_TICK_STYLE}
              axisLine={AXIS_LINE_STYLE}
              tickLine={false}
              name={xAxisLabel || xAxisKey}
            />
            <YAxis
              dataKey={stableSeries[0]?.dataKey}
              type="number"
              tick={AXIS_TICK_STYLE}
              axisLine={false}
              tickLine={false}
              name={stableSeries[0]?.label || stableSeries[0]?.dataKey}
            />
            <Tooltip content={CustomTooltip} cursor={SCATTER_CURSOR} />
            <Scatter
              name={stableSeries[0]?.label || stableSeries[0]?.dataKey}
              data={data}
              fill={chartColors[0]}
              animationDuration={700}
              animationEasing="ease-in-out"
            />
          </ScatterChart>
        );

      case "radar":
        return (
          <RadarChart data={data} outerRadius="75%">
            <PolarGrid stroke="var(--border)" opacity={0.5} />
            <PolarAngleAxis dataKey={xAxisKey} tick={POLAR_ANGLE_TICK} />
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
              <Legend
                iconType="circle"
                iconSize={7}
                wrapperStyle={LEGEND_WRAPPER_STYLE_PIE}
              />
            )}
          </RadarChart>
        );

      default:
        return null;
    }
  };

  return (
    <div
      ref={chartRef}
      className="overflow-hidden rounded-xl border border-border/70 bg-white my-4 animate-in fade-in zoom-in-[0.98] duration-500 [&_*:focus]:outline-none [&_*:focus-visible]:outline-none [&_*:focus-visible]:ring-0"
    >
      {/* Header */}
      <div className="flex flex-row justify-between items-center gap-4 border-b border-border/30 px-4 py-3">
        <div className="flex flex-col justify-center min-w-0">
          <h3 className="text-sm font-semibold text-foreground truncate">
            {title}
          </h3>
          {subtitle && (
            <p className="mt-0.5 text-xs text-muted-foreground truncate">
              {subtitle}
            </p>
          )}
        </div>
      </div>

      {/* Chart area — compact height */}
      <div className="px-2 py-4 pb-2">
        <div style={{ width: "100%", height: 240, minHeight: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
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
          {copied ? (
            <Check className="h-3 w-3 text-emerald-500" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
          {copied ? "Copied" : "Copy Data"}
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
