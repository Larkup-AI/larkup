"use client";

import { useState, useMemo, useRef, useCallback } from "react";
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
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

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
            <stop offset="5%" stopColor={color} stopOpacity={0.3} />
            <stop offset="95%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        );
      })}
    </defs>
  );
}

/* ------------------------------------------------------------------ */
/* Custom tooltip                                                      */
/* ------------------------------------------------------------------ */

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="rounded-lg border border-border/60 bg-card/95 px-3 py-2.5 shadow-lg backdrop-blur-sm">
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

// Static objects to prevent Recharts infinite loop
const AXIS_TICK_STYLE = {
  fontSize: 11,
  fill: "var(--muted-foreground)",
  fontFamily: "inherit",
};

const AXIS_LINE_STYLE = {
  stroke: "var(--border)",
};

const LEGEND_WRAPPER_STYLE = { fontSize: 12, paddingTop: 8 };
const LEGEND_WRAPPER_STYLE_PIE = { fontSize: 12 };
const PIE_LABEL_LINE = { stroke: "var(--muted-foreground)", strokeWidth: 1 };
const SCATTER_CURSOR = { strokeDasharray: "3 3" };
const POLAR_ANGLE_TICK = { fontSize: 11, fill: "var(--muted-foreground)" };
const POLAR_RADIUS_TICK = { fontSize: 10, fill: "var(--muted-foreground)" };
const ACTIVE_DOT = { r: 5, strokeWidth: 2, stroke: "var(--card)" };

const renderPieLabel = ({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`;

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

  const chartColors = useMemo(
    () =>
      series.map((s, i) => s.color || CHART_COLORS[i % CHART_COLORS.length]),
    // We deep stringify series to avoid reference changes
    [JSON.stringify(series)],
  );

  const chartDots = useMemo(() => {
    return chartColors.map(color => ({ r: 3, fill: color }));
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

  // Memoize labels to prevent Recharts loop
  const xLabelObj = useMemo(
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

  const yLabelObj = useMemo(
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

  const renderChart = () => {
    switch (chartType) {
      case "bar":
        return (
          <BarChart data={data}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--border)"
              opacity={0.5}
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
            <Tooltip content={CustomTooltip} />
            {showLegend && (
              <Legend
                iconType="circle"
                iconSize={8}
                wrapperStyle={LEGEND_WRAPPER_STYLE}
              />
            )}
            {series.map((s, i) => (
              <Bar
                key={s.dataKey}
                dataKey={s.dataKey}
                name={s.label || s.dataKey}
                fill={chartColors[i]}
                stackId={stacked ? "stack" : undefined}
                radius={[4, 4, 0, 0]}
                animationDuration={600}
                animationEasing="ease-out"
              />
            ))}
          </BarChart>
        );

      case "area":
        return (
          <AreaChart data={data}>
            <ChartGradients series={series} />
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--border)"
              opacity={0.5}
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
                iconSize={8}
                wrapperStyle={LEGEND_WRAPPER_STYLE}
              />
            )}
            {series.map((s, i) => (
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
                animationEasing="ease-out"
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
              opacity={0.5}
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
                iconSize={8}
                wrapperStyle={LEGEND_WRAPPER_STYLE}
              />
            )}
            {series.map((s, i) => (
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
                animationEasing="ease-out"
              />
            ))}
          </LineChart>
        );

      case "pie": {
        const dataKey = series[0]?.dataKey || "value";
        return (
          <PieChart>
            <Tooltip content={CustomTooltip} />
            <Pie
              data={data}
              dataKey={dataKey}
              nameKey={xAxisKey}
              cx="50%"
              cy="50%"
              outerRadius="80%"
              innerRadius="50%"
              paddingAngle={2}
              animationDuration={600}
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
                iconSize={8}
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
              opacity={0.5}
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
              dataKey={series[0]?.dataKey}
              type="number"
              tick={AXIS_TICK_STYLE}
              axisLine={false}
              tickLine={false}
              name={series[0]?.label || series[0]?.dataKey}
            />
            <Tooltip
              content={CustomTooltip}
              cursor={SCATTER_CURSOR}
            />
            <Scatter
              name={series[0]?.label || series[0]?.dataKey}
              data={data}
              fill={chartColors[0]}
              animationDuration={600}
            />
          </ScatterChart>
        );

      case "radar":
        return (
          <RadarChart data={data} outerRadius="80%">
            <PolarGrid stroke="var(--border)" />
            <PolarAngleAxis
              dataKey={xAxisKey}
              tick={POLAR_ANGLE_TICK}
            />
            <PolarRadiusAxis
              tick={POLAR_RADIUS_TICK}
            />
            <Tooltip content={CustomTooltip} />
            {series.map((s, i) => (
              <Radar
                key={s.dataKey}
                dataKey={s.dataKey}
                name={s.label || s.dataKey}
                stroke={chartColors[i]}
                fill={chartColors[i]}
                fillOpacity={0.15}
                strokeWidth={2}
                animationDuration={600}
              />
            ))}
            {showLegend && (
              <Legend
                iconType="circle"
                iconSize={8}
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
    <Card
      ref={chartRef}
      className="overflow-hidden bg-card/40 shadow-none animate-in fade-in zoom-in-95 duration-500"
    >
      <CardHeader className="flex flex-row justify-between gap-4 border-b border-border/40 bg-secondary/20 px-4 py-3">
        <div className="flex flex-col justify-center">
          <CardTitle className="text-sm font-semibold">{title}</CardTitle>
          {subtitle && (
            <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
      </CardHeader>

      {/* Chart area */}
      <CardContent className="px-2 py-4 pb-0">
        <div style={{ width: "100%", height: 300, minHeight: 300 }}>
          <ResponsiveContainer width="100%" height="100%">
            {renderChart() as any}
          </ResponsiveContainer>
        </div>
      </CardContent>

      <div className="flex flex-wrap items-center justify-start gap-2 border-t border-border/40 bg-secondary/10 px-4 py-3">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          onClick={handleCopy}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-green-500" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          {copied ? "Copied Data" : "Copy Data"}
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          onClick={handleDownload}
        >
          <Download className="h-3.5 w-3.5" />
          Download CSV
        </Button>
      </div>
    </Card>
  );
}
