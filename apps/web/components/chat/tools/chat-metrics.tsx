"use client";

import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MetricConfig {
  label: string;
  value: string | number;
  subValue?: string;
  trend?: "up" | "down" | "neutral";
  icon?: React.ReactNode;
}

export interface MetricsGridConfig {
  title?: string;
  subtitle?: string;
  metrics: MetricConfig[];
}

export function ChatMetrics({ config }: { config: MetricsGridConfig }) {
  const { title, subtitle, metrics } = config;

  if (!metrics || metrics.length === 0) return null;

  return (
    <div className="w-full bg-transparent my-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
      {(title || subtitle) && (
        <div className="mb-4">
          {title && <h3 className="text-sm font-semibold text-foreground">{title}</h3>}
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {metrics.map((metric, idx) => (
          <Card key={idx} className="bg-secondary/20 shadow-none border-border/40 hover:bg-secondary/30 transition-colors">
            <CardContent className="p-4 flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground line-clamp-1">
                  {metric.label}
                </span>
                {metric.icon && (
                  <div className="text-muted-foreground/60 shrink-0">
                    {metric.icon}
                  </div>
                )}
              </div>
              <div className="mt-1 flex items-baseline justify-between gap-2">
                <span className="text-lg font-semibold tracking-tight text-foreground">
                  {metric.value}
                </span>
              </div>
              {metric.subValue && (
                <div className="mt-1 flex items-center gap-1.5 text-[10px] font-medium">
                  {metric.trend === "up" && <TrendingUp className="size-3 text-emerald-500" />}
                  {metric.trend === "down" && <TrendingDown className="size-3 text-rose-500" />}
                  {metric.trend === "neutral" && <Minus className="size-3 text-muted-foreground" />}
                  <span
                    className={cn(
                      "text-muted-foreground",
                      metric.trend === "up" && "text-emerald-500",
                      metric.trend === "down" && "text-rose-500"
                    )}
                  >
                    {metric.subValue}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
