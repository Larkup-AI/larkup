import { NextResponse } from "next/server"
import { readConfig } from "@/core/config-store"
import { corpusStats } from "@/core/documents-store"
import { isRunning, readRun } from "@/core/index-store"
import { createRun, runIndexer } from "@/core/indexing/indexer"
import { getEmbeddingModel } from "@/core/embeddings/registry"
import type { RagConfig } from "@/core/types"

export const dynamic = "force-dynamic"

/**
 * Assess whether indexing can run with the current config + corpus.
 * Returned to the UI so it can explain exactly what is missing before enabling
 * the "Build index" button.
 */
function assessReadiness(config: RagConfig, docCount: number) {
  const blockers: string[] = []

  const model = getEmbeddingModel(config.embeddingModelId)
  if (!model) blockers.push("No embedding model is selected.")

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

  return NextResponse.json({
    run,
    running: await isRunning(),
    docCount: stats.docCount,
    charCount: stats.charCount,
    ready,
    blockers,
    config: {
      embeddingModelId: config.embeddingModelId,
      vectorStore: config.vectorStore,
      indexType: config.indexType,
      chunking: config.chunking,
    },
  })
}

export async function POST() {
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

  const run = await createRun(config)
  // Fire-and-forget: the request returns immediately and the UI polls progress.
  void runIndexer(run.id, config)

  return NextResponse.json({ run }, { status: 202 })
}
