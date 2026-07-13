import { NextResponse } from "next/server"
import { readConfig, writeConfig } from "@larkup/core/config-store"
import { getVectorStore, validateStoreConfig } from "@larkup/vector-stores/registry"
import { getEmbeddingModel } from "@larkup/core/embeddings/registry"
import { runWithServer } from "@larkup/core/workspace"
import type { RagConfig } from "@larkup/core/types"

// Uses node:fs — must run on the Node.js runtime, not edge.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function withServer<T>(serverId: string | null, fn: () => Promise<T>) {
  return serverId ? runWithServer(serverId, fn) : fn()
}

export async function GET(request: Request) {
  const serverId = new URL(request.url).searchParams.get("serverId")
  return withServer(serverId, async () => {
    const config = await readConfig()
    return NextResponse.json({ config })
  })
}

export async function PUT(request: Request) {
  const serverId = new URL(request.url).searchParams.get("serverId")
  let body: RagConfig
  try {
    body = (await request.json()) as RagConfig
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  // Validate the embedding model exists.
  const isCustom = body.embeddingModelId.startsWith("custom:")
  if (!isCustom && !getEmbeddingModel(body.embeddingModelId)) {
    return NextResponse.json(
      { error: `Unknown embedding model: ${body.embeddingModelId}` },
      { status: 400 },
    )
  }
  if (isCustom) {
    const modelName = body.embeddingModelId.slice("custom:".length)
    const found = body.customEmbeddings?.find((m) => m.modelName === modelName)
    if (!found) {
      return NextResponse.json(
        { error: `Custom embedding model "${modelName}" not found in customEmbeddings` },
        { status: 400 },
      )
    }
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

  return withServer(serverId, async () => {
    const saved = await writeConfig(body)
    return NextResponse.json({ config: saved })
  })
}

