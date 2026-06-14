import { NextResponse } from "next/server"
import { getVectorStore, validateStoreConfig } from "@buddy-rag/vector-stores/registry"
import { createAdapter } from "@buddy-rag/vector-stores/factory"
import type { RagConfig } from "@buddy-rag/core/types"

// Uses node:fs — must run on the Node.js runtime, not edge.
export const runtime = "nodejs"

export async function POST(request: Request) {
  let body: RagConfig
  try {
    body = (await request.json()) as RagConfig
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
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

  let dimensions = 1536
  const isCustom = body.embeddingModelId.startsWith("custom:")
  if (isCustom) {
    const modelName = body.embeddingModelId.slice("custom:".length)
    const found = body.customEmbeddings?.find((m) => m.modelName === modelName)
    if (!found) {
      return NextResponse.json(
        { error: `Custom embedding model "${modelName}" not found in customEmbeddings` },
        { status: 400 },
      )
    }
    dimensions = found.dimensions
  } else {
    const embeddingModel = await import("@buddy-rag/core/embeddings/registry").then(m => m.getEmbeddingModel(body.embeddingModelId))
    if (!embeddingModel) {
      return NextResponse.json(
        { error: `Unknown embedding model: ${body.embeddingModelId}` },
        { status: 400 },
      )
    }
    dimensions = embeddingModel.dimensions
  }

  try {
    const adapter = await createAdapter(body)
    await adapter.testConnection(dimensions)
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Connection failed" },
      { status: 400 },
    )
  }
}
