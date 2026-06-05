import { NextResponse } from "next/server"
import { readConfig, writeConfig } from "@buddy-rag/core/config-store"
import { getVectorStore, validateStoreConfig } from "@buddy-rag/core/vector-stores/registry"
import { getEmbeddingModel } from "@buddy-rag/core/embeddings/registry"
import type { RagConfig } from "@buddy-rag/core/types"

// Uses node:fs — must run on the Node.js runtime, not edge.
export const runtime = "nodejs"

export async function GET() {
  const config = await readConfig()
  return NextResponse.json({ config })
}

export async function PUT(request: Request) {
  let body: RagConfig
  try {
    body = (await request.json()) as RagConfig
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  // Validate the embedding model exists.
  if (!getEmbeddingModel(body.embeddingModelId)) {
    return NextResponse.json(
      { error: `Unknown embedding model: ${body.embeddingModelId}` },
      { status: 400 },
    )
  }

  // Validate the store + its dynamic, store-specific fields.
  const store = getVectorStore(body.vectorStore)
  if (!store) {
    return NextResponse.json(
      { error: `Unknown vector store: ${body.vectorStore}` },
      { status: 400 },
    )
  }
  const fieldErrors = validateStoreConfig(store, body.storeConfig ?? {}, body.indexType)
  if (Object.keys(fieldErrors).length > 0) {
    return NextResponse.json(
      { error: "Missing required vector store fields", fieldErrors },
      { status: 422 },
    )
  }

  const saved = await writeConfig(body)
  return NextResponse.json({ config: saved })
}
