import { embed, embedMany } from 'ai';
import { getEmbeddingModel } from '../embeddings/registry';
import { getAIModel } from '../embeddings/providers';
import type { RagConfig } from '../types';

export interface EmbedBatchResult {
  embeddings: number[][];
  /** dimensions of the produced vectors (sanity-checked against the registry) */
  dimensions: number;
}

/** Embed a batch of texts. Returns vectors aligned to the input order. */
export async function embedTexts(config: RagConfig, texts: string[]): Promise<EmbedBatchResult> {
  if (texts.length === 0) return { embeddings: [], dimensions: 0 };

  const model = getAIModel(config);
  const { embeddings } = await embedMany({
    model,
    values: texts,
  });

  const totalTokens = texts.reduce((acc, t) => acc + Math.ceil(t.length / 4), 0);
  const { trackUsageEvent, estimateCost } = await import('../analytics-store');

  void trackUsageEvent({
    type: 'embedding',
    embeddingModelId: config.embeddingModelId,
    embeddingTokens: totalTokens, // calculated via heuristic
    chunkCount: texts.length,
    estimatedCost: estimateCost(config.embeddingModelId, totalTokens, 0),
    timestamp: new Date().toISOString(),
  });

  return {
    embeddings,
    dimensions: embeddings[0]?.length ?? 0,
  };
}

/** Embed a single query string (used by the demo / generated server). */
export async function embedQuery(config: RagConfig, text: string): Promise<number[]> {
  const model = getAIModel(config);
  const { embedding } = await embed({ model, value: text });
  return embedding;
}

/** The expected vector size for a model, from the registry. */
export function expectedDimensions(config: RagConfig): number {
  if (config.embeddingModelId.startsWith('custom:')) {
    const customName = config.embeddingModelId.slice('custom:'.length);
    const custom = (config.customEmbeddings ?? []).find((m) => m.modelName === customName);
    if (custom) return custom.dimensions ?? 0;
  }
  return getEmbeddingModel(config.embeddingModelId)?.dimensions ?? 0;
}
