"use client";

import { useState, useEffect, useRef } from "react";
import useSWR from "swr";
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  Cpu,
  Database,
  FileText,
  Hash,
  Info,
  Layers,
  Loader2,
  Play,
  RotateCcw,
  Scissors,
} from "lucide-react";
import type {
  ChunkingParams,
  IndexRun,
  IndexType,
  VectorStoreId,
} from "@larkup/core/types";
import { getEmbeddingModel } from "@larkup/core/embeddings/registry";
import { getVectorStore } from "@larkup/vector-stores/registry";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface IndexStatus {
  run: IndexRun | null;
  running: boolean;
  docCount: number;
  charCount: number;
  ready: boolean;
  blockers: string[];
  unindexedCount: number;
  config: {
    embeddingModelId: string;
    vectorStore: VectorStoreId;
    indexType: IndexType;
    chunking: ChunkingParams;
  };
}

const ACTIVE: IndexRun["status"][] = ["chunking", "embedding", "upserting"];

interface IndexActionDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: React.ReactNode;
}

export function IndexActionDialog({
  open,
  onOpenChange,
  trigger,
}: IndexActionDialogProps) {
  const [starting, setStarting] = useState(false);

  // We maintain internal open state if it's not controlled
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const dialogOpen = isControlled ? open : internalOpen;
  const setDialogOpen =
    isControlled && onOpenChange ? onOpenChange : setInternalOpen;

  const { data, isLoading, mutate } = useSWR<IndexStatus>(
    "/api/index",
    fetcher,
    {
      refreshInterval: (d) =>
        d?.run && ACTIVE.includes(d.run.status) ? 1000 : 0,
    },
  );

  const lastWarning = useRef<string | undefined>(undefined);
  useEffect(() => {
    const warning = data?.run?.warning;
    if (warning && warning !== lastWarning.current) {
      toast.warning(warning, { id: "rate-limit-warning", duration: 70_000 });
    } else if (!warning && lastWarning.current) {
      toast.dismiss("rate-limit-warning");
      toast.success("Rate limit resolved — resuming indexing.", {
        duration: 3000,
      });
    }
    lastWarning.current = warning;
  }, [data?.run?.warning]);

  const lastStatus = useRef<IndexRun["status"] | undefined>(undefined);
  useEffect(() => {
    const status = data?.run?.status;
    if (
      status === "completed" &&
      lastStatus.current &&
      ACTIVE.includes(lastStatus.current as any)
    ) {
      setDialogOpen(false);
      toast.success("Indexing completed successfully!");
    }
    lastStatus.current = status;
  }, [data?.run?.status, setDialogOpen]);

  async function build(incremental = false) {
    setStarting(true);
    try {
      const res = await fetch("/api/index", {
        method: "POST",
        body: JSON.stringify({ incremental }),
        headers: { "Content-Type": "application/json" },
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Could not start indexing.");
        return;
      }
      toast.success("Indexing started.");
      mutate();
    } catch {
      toast.error("Could not start indexing.");
    } finally {
      setStarting(false);
    }
  }

  async function cancel() {
    setStarting(true);
    try {
      const res = await fetch("/api/index", { method: "DELETE" });
      if (!res.ok) {
        toast.error("Could not cancel indexing.");
        return;
      }
      toast.success("Indexing cancelled.");
      mutate();
    } catch {
      toast.error("Could not cancel indexing.");
    } finally {
      setStarting(false);
    }
  }

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      {trigger ? (
        <DialogTrigger 
          render={<div>{trigger}</div>}
        />
      ) : (
        <div className="flex items-center gap-2">
          {data?.run?.status === "completed" && (
            <AlertDialog>
              <AlertDialogTrigger 
                render={
                  <Button
                    disabled={
                      !data.ready ||
                      Boolean(data.run && ACTIVE.includes(data.run.status)) ||
                      starting
                    }
                    variant="outline"
                  >
                    <RotateCcw className="size-4 mr-2" />
                    Re-Index Data
                  </Button>
                }
              />
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Are you sure you want to re-index data?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    This will rebuild the entire index from scratch. All
                    documents will be re-processed.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      setDialogOpen(true);
                      build(false);
                    }}
                  >
                    Continue
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}

          <DialogTrigger
            render={
              <Button disabled={!data?.ready || data?.unindexedCount === 0}>
                <Layers className="size-4 mr-2" />
                Index Data
              </Button>
            }
          />
        </div>
      )}

      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Index Data</DialogTitle>
          <DialogDescription>
            Chunk, embed, and index into your selected vector database.
          </DialogDescription>
        </DialogHeader>

        {isLoading || !data ? (
          <div className="py-6">
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <div className="space-y-6 py-4">
            <ConfigSummary
              config={data.config}
              docCount={data.docCount}
              charCount={data.charCount}
            />

            {!data.ready && (
              <Alert variant="default">
                <AlertTriangle className="size-4 text-orange-500!" />
                <AlertTitle className="text-orange-500!">
                  Not ready to index
                </AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-4">
                    {data.blockers.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            <RunCard
              run={data.run}
              running={Boolean(data.run && ACTIVE.includes(data.run.status))}
            />

            {data.ready && !data.run && (
              <Alert>
                <Info className="size-4 text-blue-500!" />
                <AlertTitle className="text-blue-600 dark:text-blue-400">
                  Before you start indexing
                </AlertTitle>
                <AlertDescription className="text-muted-foreground space-y-1">
                  <p>
                    Once indexing begins, two settings become{" "}
                    <span className="font-medium text-foreground">locked</span>{" "}
                    to the existing index:
                  </p>
                  <ul className="list-disc pl-4 space-y-0.5">
                    <li>
                      <span className="font-medium text-foreground">
                        Embedding model
                      </span>{" "}
                      — you can swap to any model with the{" "}
                      <span className="font-medium text-foreground">
                        same vector dimensions
                      </span>
                      , but switching to a model with different dimensions will
                      require a full re-index.
                    </li>
                    <li>
                      <span className="font-medium text-foreground">
                        Vector store
                      </span>{" "}
                      — changing the store after indexing requires starting
                      fresh.
                    </li>
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            <div className="flex items-center gap-3">
              <Button
                onClick={() => build(data.run?.status === "completed")}
                disabled={
                  !data.ready ||
                  Boolean(data.run && ACTIVE.includes(data.run.status)) ||
                  starting ||
                  (data.run?.status === "completed" &&
                    data.unindexedCount === 0)
                }
                size="lg"
              >
                {Boolean(data.run && ACTIVE.includes(data.run.status)) ||
                starting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Play className="size-4" />
                )}
                {Boolean(data.run && ACTIVE.includes(data.run.status))
                  ? "Indexing…"
                  : data.run?.status === "completed"
                    ? `Index new documents (${data.unindexedCount})`
                    : `Start indexing (${data.unindexedCount})`}
              </Button>

              {Boolean(data.run && ACTIVE.includes(data.run.status)) && (
                <Button
                  onClick={cancel}
                  disabled={starting}
                  size="lg"
                  variant="destructive"
                >
                  Cancel
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ConfigSummary({
  config,
  docCount,
  charCount,
}: {
  config: IndexStatus["config"];
  docCount: number;
  charCount: number;
}) {
  const model = getEmbeddingModel(config.embeddingModelId);
  const store = getVectorStore(config.vectorStore);

  const items = [
    {
      icon: Cpu,
      label: "Embedding model",
      value: model?.label ?? config.embeddingModelId,
      hint: model ? `${model.dimensions} dims` : undefined,
    },
    {
      icon: Database,
      label: "Vector store",
      value: store?.label ?? config.vectorStore,
    },
    {
      icon: Boxes,
      label: "Index type",
      value: config.indexType.toUpperCase(),
    },
    {
      icon: Scissors,
      label: "Chunking",
      value: `${config.chunking.chunkSize} / ${config.chunking.chunkOverlap}`,
      hint: "size / overlap",
    },
    {
      icon: FileText,
      label: "Corpus",
      value: `${docCount.toLocaleString()} docs`,
      hint: `${charCount.toLocaleString()} chars`,
    },
  ];

  return (
    <div className="rounded-xl border bg-card text-card-foreground shadow-sm p-4">
      <div className="flex items-center gap-2 text-base font-semibold mb-4">
        <Layers className="size-4 text-primary" />
        Index configuration
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
        {items.map((it) => (
          <div key={it.label} className="flex flex-col gap-1.5">
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <it.icon className="size-3.5" />
              {it.label}
            </dt>
            <dd className="text-sm font-medium leading-tight">
              {it.value}
              {it.hint && (
                <span className="ml-1.5 font-mono text-[11px] font-normal text-muted-foreground">
                  {it.hint}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const STATUS_COPY: Record<
  IndexRun["status"],
  { label: string; phase?: string }
> = {
  idle: { label: "Idle" },
  chunking: { label: "Chunking", phase: "Splitting documents into chunks" },
  embedding: { label: "Embedding", phase: "Generating vector embeddings" },
  upserting: { label: "Storing", phase: "Writing vectors to the store" },
  completed: { label: "Completed" },
  failed: { label: "Failed" },
};

function RunCard({ run, running }: { run: IndexRun | null; running: boolean }) {
  if (!run) {
    return (
      <div className="rounded-xl border bg-card text-card-foreground shadow-sm flex flex-col items-center justify-center gap-1 py-8 text-center">
        <Hash className="mb-1 size-6 text-muted-foreground/60" />
        <p className="text-sm font-medium">No index built yet</p>
        <p className="text-sm text-muted-foreground">
          Build a Larkup index to embed your corpus and make it searchable.
        </p>
      </div>
    );
  }

  const copy = STATUS_COPY[run.status];
  const pct =
    run.totalChunks > 0
      ? Math.round((run.processedChunks / run.totalChunks) * 100)
      : running
        ? 5
        : 0;

  return (
    <div className="rounded-xl border bg-card text-card-foreground shadow-sm p-4 space-y-4">
      <div className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-2 text-base font-semibold">
          {run.status === "completed" ? (
            <CheckCircle2 className="size-4 text-primary" />
          ) : run.status === "failed" ? (
            <AlertTriangle className="size-4 text-destructive" />
          ) : (
            <Loader2 className="size-4 animate-spin text-primary" />
          )}
          {copy.label}
        </div>
        <StatusBadge status={run.status} />
      </div>

      {run.status === "failed" ? (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>Indexing failed</AlertTitle>
          <AlertDescription>{run.error}</AlertDescription>
        </Alert>
      ) : (
        <>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {copy.phase ?? "Done"}
              </span>
              <span className="font-mono tabular-nums">
                {run.processedChunks.toLocaleString()}
                {run.totalChunks > 0 &&
                  ` / ${run.totalChunks.toLocaleString()}`}{" "}
                chunks
              </span>
            </div>
            <Progress
              value={pct}
              className="**:data-[slot=progress-indicator]:bg-green-600"
            />
          </div>

          <dl className="grid grid-cols-2 gap-4 pt-1 sm:grid-cols-4">
            <Stat label="Documents" value={run.docCount.toLocaleString()} />
            <Stat label="Chunks" value={run.totalChunks.toLocaleString()} />
            <Stat
              label="Dimensions"
              value={run.dimensions ? run.dimensions.toLocaleString() : "—"}
            />
            <Stat
              label="Duration"
              value={
                run.durationMs
                  ? `${(run.durationMs / 1000).toFixed(1)}s`
                  : running
                    ? "running…"
                    : "—"
              }
            />
          </dl>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono text-sm tabular-nums">{value}</dd>
    </div>
  );
}

function StatusBadge({ status }: { status: IndexRun["status"] }) {
  if (status === "completed")
    return (
      <Badge className="bg-primary/12 text-primary hover:bg-primary/12">
        Ready
      </Badge>
    );
  if (status === "failed") return <Badge variant="destructive">Failed</Badge>;
  if (ACTIVE.includes(status))
    return (
      <span className="flex items-center gap-1.5 text-xs font-medium text-green-600">
        <span className="relative flex size-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-600 opacity-75" />
          <span className="relative inline-flex size-2 rounded-full bg-green-600" />
        </span>
        Live
      </span>
    );
  return null;
}
