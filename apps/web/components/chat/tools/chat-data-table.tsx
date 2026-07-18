"use client";

import { useState, useMemo, useCallback } from "react";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Copy,
  Download,
  ChevronLeft,
  ChevronRight,
  Check,
  Search,
  X,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface DataTableConfig {
  columns: string[];
  rows: Record<string, any>[];
  totalRows: number;
  aggregationResults?: Record<string, number>;
}

function formatCell(value: any): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") {
    return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }
  return String(value);
}

function downloadCSV(columns: string[], rows: Record<string, any>[]) {
  const csv = [
    columns.join(","),
    ...rows.map((row) =>
      columns
        .map((c) => {
          const v = String(row[c] ?? "");
          return v.includes(",") || v.includes('"')
            ? `"${v.replace(/"/g, '""')}"`
            : v;
        })
        .join(","),
    ),
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "data.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function copyTable(columns: string[], rows: Record<string, any>[]) {
  const text = [
    columns.join("\t"),
    ...rows.map((row) => columns.map((c) => String(row[c] ?? "")).join("\t")),
  ].join("\n");
  navigator.clipboard.writeText(text);
}

/* Column type indicators */
function columnTypeIndicator(
  col: string,
  rows: Record<string, any>[],
): { icon: string; label: string } {
  const sample = rows.slice(0, 10).map((r) => r[col]);
  const nonNull = sample.filter(
    (v) => v !== null && v !== undefined && v !== "",
  );
  if (nonNull.length === 0) return { icon: "Aa", label: "text" };
  const allNum = nonNull.every((v) => !isNaN(Number(v)));
  if (allNum) return { icon: "#", label: "number" };
  const allDate = nonNull.every((v) => !isNaN(Date.parse(String(v))));
  if (allDate) return { icon: "📅", label: "date" };
  return { icon: "Aa", label: "text" };
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

const PAGE_SIZES = [10, 25, 50, 100];

export function ChatDataTable({ config }: { config: DataTableConfig }) {
  const { columns, rows, totalRows, aggregationResults } = config;
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [searchQuery, setSearchQuery] = useState("");
  const [copied, setCopied] = useState(false);

  // Filter rows by search
  const filteredRows = useMemo(() => {
    if (!searchQuery.trim()) return rows;
    const q = searchQuery.toLowerCase();
    return rows.filter((row) =>
      columns.some((col) =>
        String(row[col] ?? "")
          .toLowerCase()
          .includes(q),
      ),
    );
  }, [rows, columns, searchQuery]);

  // Sort
  const sortedRows = useMemo(() => {
    if (!sortCol) return filteredRows;
    return [...filteredRows].sort((a, b) => {
      const va = a[sortCol];
      const vb = b[sortCol];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const na = Number(va);
      const nb = Number(vb);
      if (!isNaN(na) && !isNaN(nb))
        return sortDir === "asc" ? na - nb : nb - na;
      return sortDir === "asc"
        ? String(va).localeCompare(String(vb))
        : String(vb).localeCompare(String(va));
    });
  }, [filteredRows, sortCol, sortDir]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const displayRows = sortedRows.slice(
    page * pageSize,
    (page + 1) * pageSize,
  );

  const handleSort = useCallback(
    (col: string) => {
      if (sortCol === col) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortCol(col);
        setSortDir("asc");
      }
      setPage(0);
    },
    [sortCol],
  );

  const handleCopy = useCallback(() => {
    copyTable(columns, rows);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [columns, rows]);

  const handleDownload = useCallback(
    () => downloadCSV(columns, rows),
    [columns, rows],
  );

  if (columns.length === 0 || rows.length === 0) {
    return (
      <div className="py-4 text-center text-sm text-muted-foreground">
        No data returned
      </div>
    );
  }

  return (
    <div className="overflow-hidden bg-transparent border-0 shadow-none my-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
      {/* Aggregation results (KPI cards) */}
      {aggregationResults && Object.keys(aggregationResults).length > 0 && (
        <div className="flex flex-wrap gap-3 border-b border-border/40 px-4 py-3">
          {Object.entries(aggregationResults).map(([key, value]) => {
            const [op, ...colParts] = key.split("_");
            const col = colParts.join("_");
            return (
              <div
                key={key}
                className="flex flex-col rounded-lg bg-transparent px-2 py-1"
              >
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {op} of {col}
                </span>
                <span className="text-lg font-semibold tabular-nums text-foreground">
                  {typeof value === "number"
                    ? value.toLocaleString(undefined, {
                        maximumFractionDigits: 4,
                      })
                    : value}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Toolbar: search + actions */}
      <div className="flex items-center justify-between gap-2 border-b border-border/40 px-3 py-2">
        <div className="relative flex-1 max-w-[240px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(0);
            }}
            placeholder="Search rows…"
            className="h-8 pl-8 pr-8 text-xs"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            className="h-7 gap-1.5 text-[11px] text-muted-foreground"
          >
            {copied ? (
              <Check className="size-3 text-emerald-500" />
            ) : (
              <Copy className="size-3" />
            )}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDownload}
            className="h-7 gap-1.5 text-[11px] text-muted-foreground"
          >
            <Download className="size-3" />
            CSV
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto [&::-webkit-scrollbar]:hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30 hover:bg-muted/30">
              {columns.map((col) => {
                const { icon } = columnTypeIndicator(col, rows);
                return (
                  <TableHead
                    key={col}
                    className="cursor-pointer select-none px-3 py-2.5 text-xs font-medium transition hover:text-foreground"
                    onClick={() => handleSort(col)}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="text-[10px] opacity-50 font-mono">
                        {icon}
                      </span>
                      <span>{col}</span>
                      {sortCol === col ? (
                        sortDir === "asc" ? (
                          <ArrowUp className="size-3 text-primary" />
                        ) : (
                          <ArrowDown className="size-3 text-primary" />
                        )
                      ) : (
                        <ArrowUpDown className="size-3 opacity-20" />
                      )}
                    </span>
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayRows.map((row, i) => (
              <TableRow
                key={i}
                className={cn(
                  "transition",
                  i % 2 === 1 && "bg-muted/10",
                )}
              >
                {columns.map((col) => (
                  <TableCell
                    key={col}
                    className="max-w-[220px] truncate px-3 py-2 text-xs tabular-nums"
                    title={String(row[col] ?? "")}
                  >
                    {formatCell(row[col])}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Pagination footer */}
      <div className="flex items-center justify-between border-t border-border/40 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">
            {filteredRows.length !== rows.length
              ? `${filteredRows.length} matched of `
              : ""}
            {totalRows.toLocaleString()} rows
          </span>
          <div className="h-3 w-px bg-border" />
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">Show</span>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => {
                setPageSize(Number(v));
                setPage(0);
              }}
            >
              <SelectTrigger className="h-6 w-[52px] text-[11px] px-2">
                {pageSize}
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZES.map((s) => (
                  <SelectItem key={s} value={String(s)} className="text-xs">
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[11px] tabular-nums text-muted-foreground mr-1">
            {page + 1} / {totalPages}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
