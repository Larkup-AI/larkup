import { embed, embedMany } from "ai"
import { getEmbeddingModel } from "../embeddings/registry"

/**
 * Thin wrapper around the AI SDK's embedding API.
 *
 * Models are addressed by AI Gateway strings (e.g. "openai/text-embedding-3-small"),
 * so no provider SDKs are required — the gateway routes the request. Batches are
 * embedded with `embedMany`; we also expose a single-query helper for the demo.
 */

export interface EmbedBatchResult {
  embeddings: number[][]
  /** dimensions of the produced vectors (sanity-checked against the registry) */
  dimensions: number
}

/** Embed a batch of texts. Returns vectors aligned to the input order. */
export async function embedTexts(
  modelId: string,
  texts: string[],
): Promise<EmbedBatchResult> {
  if (texts.length === 0) return { embeddings: [], dimensions: 0 }

  const { embeddings } = await embedMany({
    model: modelId,
    values: texts,
  })

  return {
    embeddings,
    dimensions: embeddings[0]?.length ?? 0,
  }
}

/** Embed a single query string (used by the demo / generated server). */
export async function embedQuery(
  modelId: string,
  text: string,
): Promise<number[]> {
  const { embedding } = await embed({ model: modelId, value: text })
  return embedding
}

/** The expected vector size for a model, from the registry. */
export function expectedDimensions(modelId: string): number {
  return getEmbeddingModel(modelId)?.dimensions ?? 0
}
