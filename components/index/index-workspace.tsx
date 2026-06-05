"use client"

import { useState } from "react"
import useSWR from "swr"
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  Cpu,
  Database,
  FileText,
  Hash,
  Layers,
  Loader2,
  Play,
  RotateCcw,
  Scissors,
} from "lucide-react"
import type {
  ChunkingParams,
  IndexRun,
  IndexType,
  VectorStoreId,
} from "@/core/types"
import { getEmbeddingModel } from "@/core/embeddings/registry"
import { getVectorStore } from "@/core/vector-stores/registry"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "sonner"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface IndexStatus {
  run: IndexRun | null
  running: boolean
  docCount: number
  charCount: number
  ready: boolean
  blockers: string[]
  config: {
    embeddingModelId: string
    vectorStore: VectorStoreId
    indexType: IndexType
    chunking: ChunkingParams
  }
}

const ACTIVE: IndexRun["status"][] = ["chunking", "embedding", "upserting"]

export function IndexWorkspace() {
  const [starting, setStarting] = useState(false)
  const { data, isLoading, mutate } = useSWR<IndexStatus>(
    "/api/index",
    fetcher,
    {
      refreshInterval: (d) =>
        d?.run && ACTIVE.includes(d.run.status) ? 1000 : 0,
    },
  )

  if (isLoading || !data) {
    return (
      <div className="px-6 py-6 md:px-8">
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  const { run, ready, blockers, docCount, charCount, config } = data
  const running = Boolean(run && ACTIVE.includes(run.status))

  async function build() {
    setStarting(true)
    try {
      const res = await fetch("/api/index", { method: "POST" })
      const body = await res.json()
      if (!res.ok) {
        toast.error(body.error ?? "Could not start indexing.")
        return
      }
      toast.success("Indexing started.")
      mutate()
    } catch {
      toast.error("Could not start indexing.")
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="space-y-6 px-6 py-6 md:px-8">
      <ConfigSummary config={config} docCount={docCount} charCount={charCount} />

      {!ready && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>Not ready to index</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <RunCard run={run} running={running} />

      <div className="flex items-center gap-3">
        <Button
          onClick={build}
          disabled={!ready || running || starting}
          size="lg"
        >
          {running || starting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : run?.status === "completed" ? (
            <RotateCcw className="size-4" />
          ) : (
            <Play className="size-4" />
          )}
          {running
            ? "Indexing…"
            : run?.status === "completed"
              ? "Re-build index"
              : "Build index"}
        </Button>
        {run?.status === "completed" && (
          <p className="text-sm text-muted-foreground">
            Re-building replaces all existing vectors.
          </p>
        )}
      </div>
    </div>
  )
}

function ConfigSummary({
  config,
  docCount,
  charCount,
}: {
  config: IndexStatus["config"]
  docCount: number
  charCount: number
}) {
  const model = getEmbeddingModel(config.embeddingModelId)
  const store = getVectorStore(config.vectorStore)

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
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Layers className="size-4 text-primary" />
          Index configuration
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-5">
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
      </CardContent>
    </Card>
  )
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
}

function RunCard({ run, running }: { run: IndexRun | null; running: boolean }) {
  if (!run) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-1 py-12 text-center">
          <Hash className="mb-1 size-6 text-muted-foreground/60" />
          <p className="text-sm font-medium">No index built yet</p>
          <p className="text-sm text-muted-foreground">
            Build an index to embed your corpus and make it searchable.
          </p>
        </CardContent>
      </Card>
    )
  }

  const copy = STATUS_COPY[run.status]
  const pct =
    run.totalChunks > 0
      ? Math.round((run.processedChunks / run.totalChunks) * 100)
      : running
        ? 5
        : 0

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          {run.status === "completed" ? (
            <CheckCircle2 className="size-4 text-primary" />
          ) : run.status === "failed" ? (
            <AlertTriangle className="size-4 text-destructive" />
          ) : (
            <Loader2 className="size-4 animate-spin text-primary" />
          )}
          {copy.label}
        </CardTitle>
        <StatusBadge status={run.status} />
      </CardHeader>
      <CardContent className="space-y-4">
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
              <Progress value={pct} />
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
      </CardContent>
    </Card>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono text-sm tabular-nums">{value}</dd>
    </div>
  )
}

function StatusBadge({ status }: { status: IndexRun["status"] }) {
  if (status === "completed")
    return (
      <Badge className="bg-primary/12 text-primary hover:bg-primary/12">
        Ready
      </Badge>
    )
  if (status === "failed") return <Badge variant="destructive">Failed</Badge>
  if (ACTIVE.includes(status))
    return (
      <span className="flex items-center gap-1.5 text-xs text-primary">
        <span className="relative flex size-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
          <span className="relative inline-flex size-2 rounded-full bg-primary" />
        </span>
        live
      </span>
    )
  return null
}
