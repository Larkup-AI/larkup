"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import {
  AlertTriangle,
  CornerDownLeft,
  FileText,
  Loader2,
  Search,
  Server,
  Sparkles,
  Cpu,
  Database,
  ExternalLink,
} from "lucide-react";
import type { IndexType, VectorStoreId } from "@larkup-rag/core/types";
import type { QueryHit } from "@larkup-rag/vector-stores/adapter";
import { getEmbeddingModel } from "@larkup-rag/core/embeddings/registry";
import { getVectorStore } from "@larkup-rag/vector-stores/registry";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import { cn } from "@/lib/utils";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface DemoStatus {
  ready: boolean;
  blockers: string[];
  indexed: boolean;
  server: { running: boolean; endpoint: string };
  config: {
    projectName: string;
    embeddingModelId: string;
    vectorStore: VectorStoreId;
    indexType: IndexType;
    topK: number;
  };
}

interface DemoResult {
  query: string;
  hits: QueryHit[];
  source: "server" | "direct";
  endpoint?: string;
  tookMs: number;
}

const TOP_K_PRESETS = [1, 3, 5, 8, 10];

const SAMPLE_QUERIES = [
  "What is this corpus about?",
  "Summarize the key concepts.",
  "How does retrieval work?",
];

export function DemoWorkspace() {
  const { servers, activeServer } = useWorkspace();
  const [serverId, setServerId] = useState<string | null>(null);

  // Default the demo target to the active server once the workspace loads.
  useEffect(() => {
    if (!serverId && activeServer) setServerId(activeServer.id);
  }, [serverId, activeServer]);

  const statusKey = serverId
    ? `/api/demo?serverId=${encodeURIComponent(serverId)}`
    : "/api/demo";
  const { data, isLoading } = useSWR<DemoStatus>(statusKey, fetcher, {
    refreshInterval: 5000,
  });

  const [query, setQuery] = useState("");
  const [topK, setTopK] = useState<number>(5);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DemoResult | null>(null);

  // Clear any stale result when switching the target server.
  useEffect(() => {
    setResult(null);
    setError(null);
  }, [serverId]);

  if (isLoading || !data) {
    return (
      <div className="px-6 py-6 md:px-8">
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const { ready, blockers, server, config } = data;

  async function run(q: string) {
    const question = q.trim();
    if (!question) return;
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: question, topK, serverId }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Query failed.");
        setResult(null);
        return;
      }
      setResult(body as DemoResult);
    } catch {
      setError("Could not reach the retrieval endpoint.");
      setResult(null);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-6 px-6 py-6 md:px-8">
      {servers.length > 1 && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Server className="size-4" />
            Query server
          </span>
          <Select
            value={serverId ?? ""}
            onValueChange={(v) => setServerId((v as string) || null)}
          >
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Select a server">
                {(value: string) =>
                  servers.find((s) => s.id === value)?.name ?? "Select a server"
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {servers.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  <span className="flex items-center gap-2">
                    <span className="truncate">{s.name}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {s.docCount} docs{s.indexed ? " · indexed" : ""}
                      {s.running ? " · live" : ""}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {serverId && activeServer && serverId !== activeServer.id && (
            <Badge variant="secondary" className="text-xs">
              previewing another server
            </Badge>
          )}
        </div>
      )}

      <SourceSummary server={server} config={config} />

      {!ready && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>Nothing to query yet</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="relative">
            <Textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  run(query);
                }
              }}
              placeholder="Ask a question to retrieve the most relevant chunks…"
              disabled={!ready || running}
              rows={3}
              className="resize-none pr-3 text-sm leading-relaxed"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Top-k</span>
              <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-0.5">
                {TOP_K_PRESETS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setTopK(k)}
                    className={cn(
                      "min-w-8 rounded-md px-2.5 py-1 text-xs font-medium tabular-nums transition-colors",
                      topK === k
                        ? "bg-white border text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>

            <Button
              onClick={() => run(query)}
              disabled={!ready || running || !query.trim()}
            >
              {running ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Search className="size-4" />
              )}
              {running ? "Searching…" : "Search"}
              {!running && (
                <kbd className="ml-1 hidden items-center gap-0.5 rounded border border-primary-foreground/30 px-1 text-[10px] opacity-80 sm:inline-flex">
                  <CornerDownLeft className="size-2.5" />
                </kbd>
              )}
            </Button>
          </div>

          {ready && !result && !running && (
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <span className="text-xs text-muted-foreground">Try:</span>
              {SAMPLE_QUERIES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setQuery(s);
                    run(s);
                  }}
                  className="rounded-full border border-border bg-muted/40 px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>Query failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {running && <ResultsSkeleton count={topK} />}

      {!running && result && <Results result={result} />}
    </div>
  );
}

function SourceSummary({
  server,
  config,
}: {
  server: DemoStatus["server"];
  config: DemoStatus["config"];
}) {
  const model = getEmbeddingModel(config.embeddingModelId);
  const store = getVectorStore(config.vectorStore);

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-4 py-4">
        <div className="flex items-center gap-2">
          {server.running ? (
            <Badge className="gap-1.5 bg-green-600/12 text-green-600 hover:bg-green-600/12">
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-green-500" />
              </span>
              Querying live server
            </Badge>
          ) : (
            <Badge variant="secondary" className="gap-1.5">
              <Database className="size-3" />
              Direct retrieval
            </Badge>
          )}
        </div>

        <Meta
          icon={Cpu}
          label="Model"
          value={model?.label ?? config.embeddingModelId}
        />
        <Meta
          icon={Database}
          label="Store"
          value={store?.label ?? config.vectorStore}
        />
        <Meta
          icon={Sparkles}
          label="Index"
          value={config.indexType.toUpperCase()}
        />
        {server.running && (
          <Meta icon={Server} label="Endpoint" value={server.endpoint} mono />
        )}
      </CardContent>
    </Card>
  );
}

function Meta({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon: typeof Cpu;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </span>
      <span
        className={cn(
          "text-sm font-medium leading-tight",
          mono && "font-mono text-xs",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function Results({ result }: { result: DemoResult }) {
  if (result.hits.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-1 py-12 text-center">
          <Search className="mb-1 size-6 text-muted-foreground/60" />
          <p className="text-sm font-medium">No matches found</p>
          <p className="text-sm text-muted-foreground">
            Nothing in the index scored against that query. Try rephrasing or
            indexing more content.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">
          {result.hits.length} result{result.hits.length === 1 ? "" : "s"}
        </h2>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {result.source === "server" ? "via server" : "via direct"} ·{" "}
          {result.tookMs.toLocaleString()}ms
        </span>
      </div>

      {result.hits.map((hit, i) => (
        <HitCard key={hit.id || i} hit={hit} rank={i + 1} />
      ))}
    </div>
  );
}

function HitCard({ hit, rank }: { hit: QueryHit; rank: number }) {
  const pct = Math.round(Math.min(Math.max(hit.score, 0), 1) * 100);
  return (
    <Card className="overflow-hidden">
      <CardContent className="flex gap-4 py-4">
        <div className="flex flex-col items-center gap-1 pt-0.5">
          <span className="flex size-7 items-center justify-center rounded-md bg-muted text-xs font-semibold tabular-nums text-muted-foreground">
            {rank}
          </span>
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <h3 className="truncate text-sm font-medium">
                {hit.title || "Untitled"}
              </h3>
            </div>
            <Badge
              variant="secondary"
              className="shrink-0 font-mono text-[11px] tabular-nums"
            >
              {pct}%
            </Badge>
          </div>

          <p className="text-sm leading-relaxed text-muted-foreground">
            {hit.text.length > 360
              ? `${hit.text.slice(0, 360).trim()}…`
              : hit.text}
          </p>

          {hit.url && (
            <a
              href={hit.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <ExternalLink className="size-3" />
              <span className="truncate">{hit.url}</span>
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ResultsSkeleton({ count }: { count: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: Math.min(count, 4) }).map((_, i) => (
        <Card key={i}>
          <CardContent className="flex gap-4 py-4">
            <Skeleton className="size-7 rounded-md" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
