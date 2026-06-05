import type { EmbeddingModelDescriptor } from "../types"

/**
 * Selectable embedding models, addressed via AI SDK / AI Gateway model
 * strings (e.g. "openai/text-embedding-3-small"). The toolkit uses these
 * to embed chunks; the dimension is needed when creating the vector index.
 */
export const EMBEDDING_MODELS: EmbeddingModelDescriptor[] = [
  {
    id: "openai/text-embedding-3-small",
    label: "OpenAI · text-embedding-3-small",
    provider: "openai",
    dimensions: 1536,
    maxInputTokens: 8191,
    description: "Fast, cheap, strong general-purpose default.",
  },
  {
    id: "openai/text-embedding-3-large",
    label: "OpenAI · text-embedding-3-large",
    provider: "openai",
    dimensions: 3072,
    maxInputTokens: 8191,
    description: "Highest quality OpenAI embeddings, larger vectors.",
  },
  {
    id: "google/text-embedding-004",
    label: "Google · text-embedding-004",
    provider: "google",
    dimensions: 768,
    maxInputTokens: 2048,
    description: "Compact, high-quality embeddings from Google.",
  },
  {
    id: "cohere/embed-english-v3.0",
    label: "Cohere · embed-english-v3.0",
    provider: "cohere",
    dimensions: 1024,
    maxInputTokens: 512,
    description: "Tuned for retrieval; great for English-heavy corpora.",
  },
]

export function getEmbeddingModel(
  id: string,
): EmbeddingModelDescriptor | undefined {
  return EMBEDDING_MODELS.find((m) => m.id === id)
}
