import { NextResponse } from "next/server";
import { readConfig } from "@buddy-rag/core/config-store";
import { readRun } from "@buddy-rag/core/index-store";
import { refreshServerStatus } from "@buddy-rag/core/generator/server-runtime";
import { createAdapter } from "@buddy-rag/vector-stores/factory";
import { getEmbeddingModel } from "@buddy-rag/core/embeddings/registry";
import { getVectorStore } from "@buddy-rag/vector-stores/registry";
import type { QueryHit } from "@buddy-rag/vector-stores/adapter";
import { runWithServer } from "@buddy-rag/core/workspace";
import { embedQuery } from "@buddy-rag/core/indexing/embedder";

export const dynamic = "force-dynamic";

/** Run a handler against a specific server when `serverId` is provided. */
function withServer<T>(serverId: string | null, fn: () => Promise<T>) {
  return serverId ? runWithServer(serverId, fn) : fn();
}

/**
 * GET /api/demo — readiness snapshot for the Demo stage.
 *
 * Reports whether there's a built index to query and whether a generated
 * server is live, so the UI can label which path a query will take. Accepts
 * `?serverId=` to inspect a specific server instead of the active one.
 */
export async function GET(req: Request) {
  const serverId = new URL(req.url).searchParams.get("serverId");
  return withServer(serverId, () => snapshot());
}

async function snapshot() {
  const config = await readConfig();
  const run = await readRun();
  const server = await refreshServerStatus();

  const indexed = run?.status === "completed" && (run.totalChunks ?? 0) > 0;
  const ready = indexed || server.running;

  const blockers: string[] = [];
  if (!ready) {
    blockers.push(
      "Build a buddy-rag index (or launch a generated server) before running a demo query.",
    );
  }

  return NextResponse.json({
    ready,
    blockers,
    indexed,
    server: { running: server.running, endpoint: server.endpoint },
    config: {
      projectName: config.projectName,
      embeddingModelId: config.embeddingModelId,
      vectorStore: config.vectorStore,
      indexType: config.indexType,
      topK: config.topK,
    },
  });
}

interface DemoResult {
  query: string;
  hits: QueryHit[];
  source: "server" | "direct";
  endpoint?: string;
  tookMs: number;
}

/**
 * POST /api/demo — run a retrieval query.
 *
 * Prefers a running generated server (the artifact you'd deploy), so the demo
 * exercises the real serving path. Falls back to in-process retrieval against
 * the toolkit's own store when no server is running.
 */
export async function POST(req: Request) {
  const started = Date.now();

  let body: { query?: string; topK?: number; serverId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const query = body.query?.trim();
  if (!query) {
    return NextResponse.json(
      { error: "A non-empty 'query' is required." },
      { status: 400 },
    );
  }

  return withServer(body.serverId ?? null, () =>
    runQuery(query, body.topK, started),
  );
}

async function runQuery(
  query: string,
  requestedTopK: number | undefined,
  started: number,
) {
  const config = await readConfig();
  const topK = Math.min(Math.max(Number(requestedTopK) || config.topK, 1), 20);

  // 1) Prefer the running generated server — the real serving path.
  const server = await refreshServerStatus();
  if (server.running) {
    try {
      const res = await fetch(`${server.endpoint}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, topK }),
        signal: AbortSignal.timeout(30_000),
      });
      const data = await res.json();
      if (res.ok) {
        const result: DemoResult = {
          query,
          hits: data.hits ?? [],
          source: "server",
          endpoint: server.endpoint,
          tookMs: Date.now() - started,
        };
        return NextResponse.json(result);
      }
      // Fall through to direct retrieval if the server errored.
    } catch {
      // Server unreachable — fall back to direct retrieval below.
    }
  }

  // 2) Fallback: in-process retrieval against the toolkit's own store.
  const run = await readRun();
  if (!run || run.status !== "completed" || (run.totalChunks ?? 0) === 0) {
    return NextResponse.json(
      {
        error:
          "No index to query yet. Build an index in the Index stage, or launch a server first.",
      },
      { status: 409 },
    );
  }

  if (!getEmbeddingModel(config.embeddingModelId)) {
    return NextResponse.json(
      { error: `Unknown embedding model "${config.embeddingModelId}".` },
      { status: 400 },
    );
  }
  if (!getVectorStore(config.vectorStore)) {
    return NextResponse.json(
      { error: `Unknown vector store "${config.vectorStore}".` },
      { status: 400 },
    );
  }

  try {
    const vector = await embedQuery(config.embeddingModelId, query);
    const adapter = await createAdapter(config);
    const hits = await adapter.query(vector, topK);

    const result: DemoResult = {
      query,
      hits,
      source: "direct",
      tookMs: Date.now() - started,
    };
    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Retrieval failed unexpectedly.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
