import { NextResponse } from "next/server"
import { embed } from "ai"
import { getAIModel } from "@larkup-rag/core/embeddings/providers"
import type { RagConfig } from "@larkup-rag/core/types"

export const runtime = "nodejs"

export async function POST(request: Request) {
  let body: Partial<RagConfig>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { embeddingProvider, embeddingModelId } = body

  if (!embeddingProvider || !embeddingModelId) {
    return NextResponse.json(
      { error: "Missing required fields: embeddingProvider or embeddingModelId" },
      { status: 400 },
    )
  }

  try {
    const model = getAIModel(body as RagConfig)
    const { embedding } = await embed({ model, value: "test connection" })

    return NextResponse.json({ success: true, dimensions: embedding.length })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Connection failed. Please check your API key." },
      { status: 400 },
    )
  }
}
