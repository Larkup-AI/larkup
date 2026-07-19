"use client";

import { useMemo } from "react";
import type { ColumnMeta } from "@larkup/core/tabular-store";

const TYPE_BADGES: Record<
  string,
  { icon: string; label: string; color: string }
> = {
  number: {
    icon: "🔢",
    label: "Number",
    color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  },
  string: {
    icon: "📝",
    label: "Text",
    color:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  },
  date: {
    icon: "📅",
    label: "Date",
    color:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  },
  boolean: {
    icon: "✓",
    label: "Boolean",
    color:
      "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
  },
  mixed: {
    icon: "◆",
    label: "Mixed",
    color: "bg-gray-100 text-gray-700 dark:bg-gray-800/50 dark:text-gray-300",
  },
};

function TypeBadge({ type }: { type: string }) {
  const badge = TYPE_BADGES[type] ?? TYPE_BADGES.mixed;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${badge.color}`}
    >
      <span>{badge.icon}</span>
      <span>{badge.label}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Summary stats mini-cards                                            */
/* ------------------------------------------------------------------ */

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col rounded-md bg-secondary/50 px-2.5 py-1.5">
      <span className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="text-sm font-semibold tabular-nums text-foreground">
        {typeof value === "number"
          ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
          : value}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main preview component                                              */
/* ------------------------------------------------------------------ */

interface TabularPreviewProps {
  rows: Record<string, any>[];
  columns?: ColumnMeta[];
  maxPreviewRows?: number;
  maxPreviewColumns?: number;
}

export function TabularPreview({
  rows,
  columns: providedColumns,
  maxPreviewRows = 8,
  maxPreviewColumns = 10,
}: TabularPreviewProps) {
  // Auto-detect columns if not provided
  const columnNames = useMemo(() => {
    if (providedColumns) return providedColumns.map((c) => c.name);
    if (rows.length > 0) return Object.keys(rows[0]);
    return [];
  }, [providedColumns, rows]);

  const columnMeta = useMemo(() => {
    if (providedColumns) return providedColumns;
    // Quick type detection for preview
    return columnNames.map((name) => {
      const vals = rows.slice(0, 20).map((r) => r[name]);
      const nonNull = vals.filter((v) => v != null && v !== "");
      const allNum =
        nonNull.length > 0 && nonNull.every((v) => !isNaN(Number(v)));
      return {
        name,
        type: allNum ? "number" : "string",
        nullCount: vals.length - nonNull.length,
        uniqueCount: new Set(nonNull.map(String)).size,
      } as ColumnMeta;
    });
  }, [providedColumns, columnNames, rows]);

  // Numeric columns with stats
  const numericStats = useMemo(() => {
    return columnMeta.filter((c) => c.type === "number" && c.stats).slice(0, 4);
  }, [columnMeta]);

  const previewRows = rows.slice(0, maxPreviewRows);
  const previewColumnNames = columnNames.slice(0, maxPreviewColumns);
  const previewColumnMeta = columnMeta.slice(0, maxPreviewColumns);
  const hasMoreColumns = columnNames.length > maxPreviewColumns;

  if (rows.length === 0 || columnNames.length === 0) {
    return (
      <div className="rounded-lg border border-border/60 bg-card px-4 py-6 text-center text-xs text-muted-foreground">
        No data to preview
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Column type badges */}
      <div className="flex flex-wrap gap-1.5">
        {previewColumnMeta.map((col) => (
          <div
            key={col.name}
            className="flex items-center gap-1 rounded-md border border-border/40 bg-card px-2 py-1 text-xs"
          >
            <span className="font-medium text-foreground">{col.name}</span>
            <TypeBadge type={col.type} />
          </div>
        ))}
        {hasMoreColumns && (
          <div className="flex items-center gap-1 rounded-md border border-border/40 bg-card px-2 py-1 text-xs">
            <span className="font-medium text-muted-foreground">
              ... (+ {columnNames.length - maxPreviewColumns} more)
            </span>
          </div>
        )}
      </div>

      {/* Summary stats for numeric columns */}
      {numericStats.length > 0 && (
        <div className="space-y-2">
          {numericStats.map((col) => (
            <div key={col.name}>
              <div className="mb-1 text-[10px] font-medium text-muted-foreground">
                {col.name}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {col.stats && (
                  <>
                    <StatCard label="Min" value={col.stats.min} />
                    <StatCard label="Max" value={col.stats.max} />
                    <StatCard label="Mean" value={col.stats.mean} />
                    <StatCard label="Median" value={col.stats.median} />
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Data preview table */}
      <div className="overflow-hidden rounded-lg border border-border/60">
        <div className="overflow-x-auto [&::-webkit-scrollbar]:hidden">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border/40 bg-secondary/30">
                {previewColumnNames.map((col) => (
                  <th
                    key={col}
                    className="whitespace-nowrap px-2.5 py-2 font-medium text-muted-foreground"
                  >
                    {col}
                  </th>
                ))}
                {hasMoreColumns && (
                  <th className="whitespace-nowrap px-2.5 py-2 font-medium text-muted-foreground">
                    ...
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row, i) => (
                <tr key={i} className="border-b border-border/20 last:border-0">
                  {previewColumnNames.map((col) => (
                    <td
                      key={col}
                      className="max-w-[150px] truncate whitespace-nowrap px-2.5 py-1.5 tabular-nums text-foreground"
                      title={String(row[col] ?? "")}
                    >
                      {row[col] === null || row[col] === undefined
                        ? "—"
                        : String(row[col])}
                    </td>
                  ))}
                  {hasMoreColumns && (
                    <td className="px-2.5 py-1.5 text-muted-foreground">
                      ...
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > maxPreviewRows && (
          <div className="border-t border-border/40 px-3 py-1.5 text-center text-[10px] text-muted-foreground">
            Showing {maxPreviewRows} of {rows.length} rows
          </div>
        )}
      </div>
    </div>
  );
}
