"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { formatErrorMessage } from "@/lib/error-formatter";
import {
  FileUp,
  Loader2,
  X,
  Settings2,
  Columns,
  Plus,
  Database,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { TabularPreview } from "@/components/data/tabular-preview";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";

const ACCEPT =
  ".txt,.md,.markdown,.json,.csv,.html,.htm,.log,.xlsx,.xls,.pdf,.doc,.docx";

type FileFormat = "plain" | "lines" | "structured";

interface StagedFile {
  id: string;
  name: string;
  size: number;
  format: FileFormat;
  rawContent?: string;
  rows?: any[];
  keys?: string[];
  // mapping for structured
  titleKey?: string;
  contentKeys?: string[];
  contentSeparator?: string;
  metadataKeys?: string[];
  globalMetadata?: { key: string; value: string }[];
  /** When true, structured data is also saved as a TabularDataset for analytics */
  indexAsTabular?: boolean;
  /** Expanded preview state */
  showPreview?: boolean;
}

export function UploadPanel({ onAdded }: { onAdded: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);

  // Mapping state
  const [editingFileId, setEditingFileId] = useState<string | null>(null);
  const editingFile = staged.find((f) => f.id === editingFileId);

  async function readFiles(files: FileList | File[]) {
    const next: StagedFile[] = [];
    for (const file of Array.from(files)) {
      const ext = file.name.split(".").pop()?.toLowerCase();
      const id = Math.random().toString(36).slice(2);
      try {
        if (ext === "csv") {
          const content = await file.text();
          const result = Papa.parse(content, {
            header: true,
            skipEmptyLines: true,
          });
          if (result.data.length > 0) {
            const keys = Object.keys(result.data[0] as object);
            next.push({
              id,
              name: file.name,
              size: file.size,
              format: "structured",
              rows: result.data,
              keys,
              titleKey: keys[0],
              contentKeys: keys,
              contentSeparator: ", ",
              metadataKeys: keys.slice(1),
              globalMetadata: [],
              indexAsTabular: true,
            });
          }
        } else if (ext === "xlsx" || ext === "xls") {
          const data = await file.arrayBuffer();
          const workbook = XLSX.read(data, { type: "array", cellDates: true });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const rawRows = XLSX.utils.sheet_to_json(sheet) as Record<
            string,
            any
          >[];
          // Convert any Date objects to ISO date strings so they display correctly
          const rows = rawRows.map((row) => {
            const out: Record<string, any> = {};
            for (const [k, v] of Object.entries(row)) {
              out[k] = v instanceof Date ? v.toISOString().split("T")[0] : v;
            }
            return out;
          });
          if (rows.length > 0) {
            const keys = Object.keys(rows[0] as object);
            next.push({
              id,
              name: file.name,
              size: file.size,
              format: "structured",
              rows,
              keys,
              titleKey: keys[0],
              contentKeys: keys,
              contentSeparator: ", ",
              metadataKeys: keys.slice(1),
              globalMetadata: [],
              indexAsTabular: true,
            });
          }
        } else if (ext === "json") {
          const content = await file.text();
          try {
            const parsed = JSON.parse(content);
            if (
              Array.isArray(parsed) &&
              parsed.length > 0 &&
              typeof parsed[0] === "object"
            ) {
              const keys = Object.keys(parsed[0]);
              next.push({
                id,
                name: file.name,
                size: file.size,
                format: "structured",
                rows: parsed,
                keys,
                titleKey: keys[0],
                contentKeys: keys,
                contentSeparator: ", ",
                metadataKeys: keys.slice(1),
                globalMetadata: [],
                indexAsTabular: true,
              });
            } else {
              // fallback to plain
              next.push({
                id,
                name: file.name,
                size: file.size,
                format: "plain",
                rawContent: content,
              });
            }
          } catch {
            next.push({
              id,
              name: file.name,
              size: file.size,
              format: "plain",
              rawContent: content,
            });
          }
        } else if (ext === "pdf" || ext === "doc" || ext === "docx") {
          const formData = new FormData();
          formData.append("file", file);

          const res = await fetch("/api/parse-file", {
            method: "POST",
            body: formData,
          });

          if (!res.ok) {
            throw new Error(`Failed to parse ${file.name}`);
          }

          const { text } = await res.json();
          next.push({
            id,
            name: file.name,
            size: file.size,
            format: "plain",
            rawContent: text,
          });
        } else {
          const content = await file.text();
          next.push({
            id,
            name: file.name,
            size: file.size,
            format: "plain",
            rawContent: content,
          });
        }
      } catch (err) {
        toast.error(`Could not read ${file.name}. ${formatErrorMessage(err)}`);
      }
    }
    setStaged((prev) => [...prev, ...next]);
  }

  async function ingest() {
    if (staged.length === 0) return;
    setSaving(true);
    let ok = 0;

    const payloads: any[] = [];

    // First: save tabular datasets for files with indexAsTabular enabled
    for (const f of staged) {
      if (f.format === "structured" && f.rows && f.indexAsTabular) {
        try {
          const res = await fetch("/api/tabular", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fileName: f.name, rows: f.rows }),
          });
          if (res.ok) {
            const result = await res.json();
            toast.success(
              `Saved "${f.name}" as tabular dataset (${result.rowCount} rows, ${result.columns.length} columns)`,
            );
          }
        } catch {
          /* continue — still add as documents */
        }
      }
    }

    // Then: create document payloads
    for (const f of staged) {
      if (f.format === "plain" && f.rawContent) {
        payloads.push({
          title: f.name,
          content: f.rawContent,
          source: "upload",
        });
      } else if (f.format === "lines" && f.rawContent) {
        const lines = f.rawContent
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        lines.forEach((line, i) => {
          payloads.push({
            title: `${f.name} - Line ${i + 1}`,
            content: line,
            source: "upload",
          });
        });
      } else if (f.format === "structured" && f.rows) {
        for (let i = 0; i < f.rows.length; i++) {
          const row = f.rows[i];
          const title = f.titleKey
            ? String(row[f.titleKey] || `Row ${i + 1}`)
            : `Row ${i + 1}`;

          let content = "";
          if (f.contentKeys && f.contentKeys.length > 0) {
            content = f.contentKeys
              .map((k) => `${k}: ${String(row[k] || "")}`)
              .filter(Boolean)
              .join(f.contentSeparator || " | ");
          } else {
            content = Object.entries(row)
              .map(([k, v]) => `${k}: ${v}`)
              .join(" | ");
          }

          const metadata: Record<string, any> = {};
          if (f.metadataKeys) {
            for (const mk of f.metadataKeys) {
              metadata[mk] = row[mk];
            }
          }
          if (f.globalMetadata) {
            for (const gm of f.globalMetadata) {
              if (gm.key.trim()) {
                metadata[gm.key.trim()] = gm.value;
              }
            }
          }

          if (content.trim()) {
            payloads.push({
              title,
              content,
              metadata,
              source: f.indexAsTabular ? "tabular" : "upload",
            });
          }
        }
      }
    }

    setProgress({ current: 0, total: payloads.length });

    for (const [index, p] of payloads.entries()) {
      try {
        const res = await fetch("/api/documents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(p),
        });
        if (res.ok) ok++;
      } catch {
        /* continue */
      }
      setProgress({ current: index + 1, total: payloads.length });
    }

    setSaving(false);
    setProgress(null);
    setStaged([]);
    if (ok > 0) {
      toast.success(
        `Added ${ok} document${ok > 1 ? "s" : ""} from ${staged.length} file${staged.length > 1 ? "s" : ""}`,
      );
      onAdded();
    } else {
      toast.error("No documents could be added.");
    }
  }

  function updateEditingFile(patch: Partial<StagedFile>) {
    setStaged((prev) =>
      prev.map((f) => (f.id === editingFileId ? { ...f, ...patch } : f)),
    );
  }

  return (
    <div className="space-y-4 cursor-pointer">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files?.length) readFiles(e.dataTransfer.files);
        }}
        className={cn(
          "flex w-full flex-col cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 px-6 py-10 text-center transition-colors hover:bg-muted/70",
          dragging && "border-primary bg-accent",
        )}
      >
        <FileUp className="size-6 text-muted-foreground" />
        <span className="text-sm font-medium">
          Drop files here or click to browse
        </span>
        <span className="text-xs text-muted-foreground">
          Text, JSON, CSV, Excel, PDF, and Word files
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="sr-only"
        onChange={(e) => {
          if (e.target.files?.length) readFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {staged.length > 0 && (
        <ul className="space-y-1.5">
          {staged.map((f) => (
            <li
              key={f.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm"
            >
              <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                <span className="truncate font-mono text-xs">{f.name}</span>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  {f.format === "structured"
                    ? "STRUCTURED"
                    : f.format === "lines"
                      ? "SPLIT BY LINE"
                      : "PLAIN TEXT"}
                  {f.format === "structured" && ` • ${f.rows?.length} ROWS`}
                  {f.indexAsTabular && " • TABULAR"}
                </span>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {(f.size / 1024).toFixed(1)} KB
              </span>

              <div className="flex items-center gap-1 shrink-0">
                {/* Tabular indexing toggle for structured files */}
                {f.format === "structured" && (
                  <button
                    type="button"
                    aria-label="Toggle tabular indexing"
                    title={
                      f.indexAsTabular
                        ? "Tabular indexing ON"
                        : "Enable tabular indexing for data analysis"
                    }
                    onClick={() =>
                      setStaged((p) =>
                        p.map((item) =>
                          item.id === f.id
                            ? { ...item, indexAsTabular: !item.indexAsTabular }
                            : item,
                        ),
                      )
                    }
                    className={cn(
                      "p-1.5 border rounded-md transition-colors cursor-pointer",
                      f.indexAsTabular
                        ? "bg-primary/10 border-primary/30 text-primary"
                        : "bg-secondary text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                    )}
                  >
                    <Database className="size-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  aria-label={`Configure ${f.name}`}
                  onClick={() => setEditingFileId(f.id)}
                  className="p-1.5 bg-secondary cursor-pointer border text-muted-foreground hover:bg-muted/50 hover:text-foreground rounded-md transition-colors"
                >
                  <Settings2 className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${f.name}`}
                  onClick={() =>
                    setStaged((p) => p.filter((item) => item.id !== f.id))
                  }
                  className="p-1.5 border bg-muted hover:bg-muted/50 cursor-pointer text-muted-foreground hover:text-foreground rounded-md transition-colors"
                >
                  <X className="size-3.5 text-red-500" />
                </button>
              </div>

              {/* Tabular preview for structured files with tabular indexing */}
              {f.format === "structured" && f.indexAsTabular && f.rows && (
                <div className="col-span-full mt-2 w-full">
                  <TabularPreview rows={f.rows} maxPreviewRows={5} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {progress && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Uploading documents...</span>
            <span className="tabular-nums font-mono">
              {progress.current} / {progress.total}
            </span>
          </div>
          <Progress value={(progress.current / progress.total) * 100} />
        </div>
      )}

      <Button onClick={ingest} disabled={saving || staged.length === 0}>
        {saving ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <FileUp className="size-4" />
        )}
        {saving && progress
          ? `Adding ${progress.current} of ${progress.total}`
          : `Add ${staged.length > 0 ? staged.length : ""} file${staged.length === 1 ? "" : "s"} to corpus`}
      </Button>

      {/* Mapping Dialog */}
      <Dialog
        open={!!editingFile}
        onOpenChange={(open) => !open && setEditingFileId(null)}
      >
        <DialogContent className="sm:max-w-xl max-h-[80%]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Columns className="size-4 text-primary" />
              Configure Ingestion
            </DialogTitle>
          </DialogHeader>

          {editingFile && (
            <div
              className="py-4 space-y-6 overflow-y-auto pr-2"
              style={{ maxHeight: "calc(80vh - 120px)" }}
            >
              {editingFile.format === "structured" ? (
                <>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Title Column</Label>
                      <Select
                        value={editingFile.titleKey}
                        onValueChange={(val) =>
                          updateEditingFile({ titleKey: val || undefined })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select column" />
                        </SelectTrigger>
                        <SelectContent>
                          {editingFile.keys?.map((k) => (
                            <SelectItem key={k} value={k}>
                              {k}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[11px] text-muted-foreground">
                        Used as the document name.
                      </p>
                    </div>

                    <div className="space-y-3 pt-2 border-t border-border">
                      <div className="flex items-center justify-between">
                        <Label>Content Columns</Label>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="text-[10px] uppercase font-medium text-primary hover:underline cursor-pointer"
                            onClick={() => {
                              updateEditingFile({
                                contentKeys: editingFile.keys || [],
                              });
                            }}
                          >
                            Select All
                          </button>
                          <span className="text-muted-foreground text-[10px]">
                            |
                          </span>
                          <button
                            type="button"
                            className="text-[10px] uppercase font-medium text-muted-foreground hover:underline cursor-pointer"
                            onClick={() => {
                              updateEditingFile({ contentKeys: [] });
                            }}
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                      <p className="text-[11px] text-muted-foreground mb-2 -mt-1">
                        Selected columns will be combined to form the searchable
                        content.
                      </p>
                      <div className="max-h-[120px] overflow-y-auto space-y-2 pr-2">
                        {editingFile.keys?.map((k) => {
                          const isSelected =
                            editingFile.contentKeys?.includes(k);
                          return (
                            <div
                              key={k}
                              className="flex items-center space-x-2"
                            >
                              <Checkbox
                                id={`content-${k}`}
                                checked={isSelected}
                                onCheckedChange={(checked) => {
                                  const current = editingFile.contentKeys || [];
                                  if (checked) {
                                    updateEditingFile({
                                      contentKeys: [...current, k],
                                    });
                                  } else {
                                    updateEditingFile({
                                      contentKeys: current.filter(
                                        (x) => x !== k,
                                      ),
                                    });
                                  }
                                }}
                              />
                              <label
                                htmlFor={`content-${k}`}
                                className="text-sm font-medium leading-none"
                              >
                                {k}
                              </label>
                            </div>
                          );
                        })}
                      </div>

                      {editingFile.contentKeys &&
                        editingFile.contentKeys.length > 1 && (
                          <div className="pt-2">
                            <Label className="mb-2 block">Separator</Label>
                            <Select
                              value={editingFile.contentSeparator || " "}
                              onValueChange={(val) =>
                                updateEditingFile({
                                  contentSeparator: val || undefined,
                                })
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select separator" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value=" ">Space</SelectItem>
                                <SelectItem value=", ">Comma</SelectItem>
                                <SelectItem value="\n">Newline</SelectItem>
                                <SelectItem value=" - ">Hyphen</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                    </div>

                    <div className="space-y-3 pt-2 border-t border-border">
                      <div className="flex items-center justify-between">
                        <Label>Metadata Columns</Label>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="text-[10px] uppercase font-medium text-primary hover:underline cursor-pointer"
                            onClick={() => {
                              const availableKeys =
                                editingFile.keys?.filter(
                                  (k) => k !== editingFile.titleKey,
                                ) || [];
                              updateEditingFile({
                                metadataKeys: availableKeys,
                              });
                            }}
                          >
                            Select All
                          </button>
                          <span className="text-muted-foreground text-[10px]">
                            |
                          </span>
                          <button
                            type="button"
                            className="text-[10px] uppercase font-medium text-muted-foreground hover:underline cursor-pointer"
                            onClick={() => {
                              updateEditingFile({ metadataKeys: [] });
                            }}
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                      <p className="text-[11px] text-muted-foreground mb-2 -mt-1">
                        These columns will be stored as searchable metadata.
                      </p>
                      <div className="max-h-[120px] overflow-y-auto space-y-2 pr-2">
                        {editingFile.keys?.map((k) => {
                          const isSelected =
                            editingFile.metadataKeys?.includes(k);
                          const disabled = k === editingFile.titleKey;
                          return (
                            <div
                              key={k}
                              className="flex items-center space-x-2"
                            >
                              <Checkbox
                                id={`meta-${k}`}
                                checked={isSelected}
                                disabled={disabled}
                                onCheckedChange={(checked) => {
                                  const current =
                                    editingFile.metadataKeys || [];
                                  if (checked) {
                                    updateEditingFile({
                                      metadataKeys: [...current, k],
                                    });
                                  } else {
                                    updateEditingFile({
                                      metadataKeys: current.filter(
                                        (x) => x !== k,
                                      ),
                                    });
                                  }
                                }}
                              />
                              <label
                                htmlFor={`meta-${k}`}
                                className={cn(
                                  "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
                                  disabled && "text-muted-foreground",
                                )}
                              >
                                {k} {disabled && "(used)"}
                              </label>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between rounded-lg border border-border p-3">
                    <div className="space-y-0.5">
                      <Label>Split by Line</Label>
                      <p className="text-[11px] text-muted-foreground">
                        Treat each line as a completely separate document.
                      </p>
                    </div>
                    <Switch
                      checked={editingFile.format === "lines"}
                      onCheckedChange={(checked) =>
                        updateEditingFile({
                          format: checked ? "lines" : "plain",
                        })
                      }
                    />
                  </div>
                </div>
              )}

              <div className="space-y-3 pt-4 border-t border-border">
                <div className="flex items-center justify-between">
                  <Label>Global Custom Metadata</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => {
                      const current = editingFile.globalMetadata || [];
                      updateEditingFile({
                        globalMetadata: [...current, { key: "", value: "" }],
                      });
                    }}
                  >
                    <Plus className="size-3 mr-1" /> Add Field
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground mb-2">
                  Apply custom key-value pairs to every document generated from
                  this file.
                </p>
                <div className="space-y-2">
                  {(editingFile.globalMetadata || []).map((gm, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        placeholder="Key"
                        value={gm.key}
                        className="h-8 text-xs font-mono"
                        onChange={(e) => {
                          const next = [...(editingFile.globalMetadata || [])];
                          next[i].key = e.target.value;
                          updateEditingFile({ globalMetadata: next });
                        }}
                      />
                      <Input
                        placeholder="Value"
                        value={gm.value}
                        className="h-8 text-xs font-mono"
                        onChange={(e) => {
                          const next = [...(editingFile.globalMetadata || [])];
                          next[i].value = e.target.value;
                          updateEditingFile({ globalMetadata: next });
                        }}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground shrink-0"
                        onClick={() => {
                          const next = [...(editingFile.globalMetadata || [])];
                          next.splice(i, 1);
                          updateEditingFile({ globalMetadata: next });
                        }}
                      >
                        <X className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                  {(!editingFile.globalMetadata ||
                    editingFile.globalMetadata.length === 0) && (
                    <p className="text-xs text-muted-foreground italic text-center py-2">
                      No custom metadata.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="pb-2! bg-muted ">
            <Button onClick={() => setEditingFileId(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
