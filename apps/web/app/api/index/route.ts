import { NextResponse } from "next/server"
import { readConfig } from "@larkup/core/config-store"
import { corpusStats } from "@larkup/core/documents-store"
import { isRunning, readRun } from "@larkup/core/index-store"
import { createRun, runIndexer } from "@larkup/core/indexing/indexer"
import { getEmbeddingModel } from "@larkup/core/embeddings/registry"
import type { RagConfig } from "@larkup/core/types"

export const dynamic = "force-dynamic"

/**
 * Assess whether indexing can run with the current config + corpus.
 * Returned to the UI so it can explain exactly what is missing before enabling
 * the "Build index" button.
 */
function assessReadiness(config: RagConfig, docCount: number) {
  const blockers: string[] = []

  const model = getEmbeddingModel(config.embeddingModelId)
  if (!model && !config.embeddingModelId?.startsWith("custom:")) blockers.push("No embedding model is selected.")

  if (docCount === 0)
    blockers.push("The corpus is empty — load documents in the Data stage.")

  // Pinecone needs a hosted index + key; LanceDB is local and always ready.
  if (config.vectorStore === "pinecone") {
    if (!config.storeConfig?.apiKey?.trim())
      blockers.push("PINECONE_API_KEY is not set.")
    if (!config.storeConfig?.indexName?.trim())
      blockers.push("A Pinecone index name is required.")
  }

  return { ready: blockers.length === 0, blockers }
}

export async function GET() {
  const [config, stats, run] = await Promise.all([
    readConfig(),
    corpusStats(),
    readRun(),
  ])
  const { ready, blockers } = assessReadiness(config, stats.docCount)

  let unindexedCount = 0
  if (run?.status === "completed") {
    const { readDocuments } = await import("@larkup/core/documents-store")
    const docs = await readDocuments()
    unindexedCount = docs.filter(d => d.createdAt > run.startedAt).length
  } else {
    unindexedCount = stats.docCount
  }

  return NextResponse.json({
    run,
    running: await isRunning(),
    docCount: stats.docCount,
    charCount: stats.charCount,
    ready,
    blockers,
    unindexedCount,
    config: {
      embeddingModelId: config.embeddingModelId,
      vectorStore: config.vectorStore,
      indexType: config.indexType,
      chunking: config.chunking,
    },
  })
}

export async function POST(req: Request) {
  if (await isRunning()) {
    return NextResponse.json(
      { error: "An indexing run is already in progress." },
      { status: 409 },
    )
  }

  const [config, stats] = await Promise.all([readConfig(), corpusStats()])
  const { ready, blockers } = assessReadiness(config, stats.docCount)
  if (!ready) {
    return NextResponse.json(
      { error: blockers.join(" ") || "Indexing is not ready.", blockers },
      { status: 400 },
    )
  }

  let body: any = {}
  try {
    body = await req.json()
  } catch {}
  
  const incremental = body.incremental === true
  const previousRun = await readRun()

  const run = await createRun(config)
  // Fire-and-forget: the request returns immediately and the UI polls progress.
  void runIndexer(run.id, config, incremental ? previousRun : null)

  return NextResponse.json({ run }, { status: 202 })
}

export async function DELETE() {
  const { readRun, patchRun } = await import("@larkup/core/index-store")
  const run = await readRun()
  if (run && ["chunking", "embedding", "upserting"].includes(run.status)) {
    await patchRun({
      status: "failed",
      error: "Cancelled by user.",
      finishedAt: new Date().toISOString(),
    })
  }
  return NextResponse.json({ success: true })
}
