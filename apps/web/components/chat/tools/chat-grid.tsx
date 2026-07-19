"use client";

import { cn } from "@/lib/utils";

export interface ChatGridItem {
  label: string;
  value: string | number;
  subValue?: string;
  icon?: React.ReactNode;
  /** Optional accent color for the value — 'emerald' | 'amber' | 'rose' | 'blue' | 'default' */
  accent?: "emerald" | "amber" | "rose" | "blue" | "default";
}

export interface ChatGridConfig {
  title?: string;
  subtitle?: string;
  items: ChatGridItem[];
  /** Number of columns (auto-detected if omitted) */
  columns?: 2 | 3 | 4;
}

const accentClasses: Record<string, string> = {
  emerald: "text-emerald-600 dark:text-emerald-400",
  amber: "text-amber-600 dark:text-amber-400",
  rose: "text-rose-600 dark:text-rose-400",
  blue: "text-blue-600 dark:text-blue-400",
  default: "text-foreground",
};

/**
 * A responsive card grid for displaying structured data in a compact form.
 * Auto-sizes to 2-4 columns based on item count.
 */
export function ChatGrid({ config }: { config: ChatGridConfig }) {
  const { title, subtitle, items, columns } = config;

  if (!items || items.length === 0) return null;

  // Auto-determine columns
  const colCount =
    columns || (items.length <= 2 ? 2 : items.length <= 3 ? 3 : 4);

  const gridClass =
    colCount === 2
      ? "grid-cols-2"
      : colCount === 3
        ? "grid-cols-2 md:grid-cols-3"
        : "grid-cols-2 md:grid-cols-4";

  return (
    <div className="w-full my-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
      {(title || subtitle) && (
        <div className="mb-3">
          {title && (
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          )}
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
          )}
        </div>
      )}

      <div className={cn("grid gap-2.5", gridClass)}>
        {items.map((item, idx) => (
          <div
            key={idx}
            className="flex flex-col gap-1 rounded-xl border border-border/40 bg-card/30 p-3.5 transition-colors hover:bg-card/50"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider line-clamp-1">
                {item.label}
              </span>
              {item.icon && (
                <span className="shrink-0 text-muted-foreground/50 [&_svg]:size-3.5">
                  {item.icon}
                </span>
              )}
            </div>
            <span
              className={cn(
                "text-lg font-semibold tracking-tight tabular-nums",
                accentClasses[item.accent || "default"],
              )}
            >
              {typeof item.value === "number"
                ? item.value.toLocaleString()
                : item.value}
            </span>
            {item.subValue && (
              <span className="text-[10px] text-muted-foreground">
                {item.subValue}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
