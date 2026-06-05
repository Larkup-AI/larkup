import { NextResponse } from "next/server"
import { getVectorStore, validateStoreConfig } from "@/core/vector-stores/registry"
import { createAdapter } from "@/core/vector-stores/factory"
import type { RagConfig } from "@/core/types"

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

  const fieldErrors = validateStoreConfig(store, body.storeConfig ?? {})
  if (Object.keys(fieldErrors).length > 0) {
    return NextResponse.json(
      { error: "Missing required vector store fields", fieldErrors },
      { status: 422 },
    )
  }

  try {
    const adapter = await createAdapter(body)
    await adapter.testConnection()
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Connection failed" },
      { status: 400 },
    )
  }
}
