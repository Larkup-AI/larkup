import type { EmbeddingModelDescriptor } from "../types"

/**
 * Selectable embedding models, addressed via AI SDK / AI Gateway model
 * strings (e.g. "openai/text-embedding-3-small"). The toolkit uses these
 * to embed chunks; the dimension is needed when creating the vector index.
 */
export const EMBEDDING_MODELS: EmbeddingModelDescriptor[] = [
  // ── OpenAI ──────────────────────────────────────────────────────────
  {
    id: "openai/text-embedding-3-small",
    label: "text-embedding-3-small",
    provider: "openai",
    dimensions: 1536,
    maxInputTokens: 8191,
    description: "Fast, cheap, strong general-purpose default.",
  },
  {
    id: "openai/text-embedding-3-large",
    label: "text-embedding-3-large",
    provider: "openai",
    dimensions: 3072,
    maxInputTokens: 8191,
    description: "Highest quality OpenAI embeddings, larger vectors.",
  },
  {
    id: "openai/text-embedding-ada-002",
    label: "text-embedding-ada-002",
    provider: "openai",
    dimensions: 1536,
    maxInputTokens: 8191,
    description: "Legacy model — kept for backward compatibility.",
  },

  // ── Google ───────────────────────────────────────────────────────────
  {
    id: "google/text-embedding-004",
    label: "text-embedding-004",
    provider: "google",
    dimensions: 768,
    maxInputTokens: 2048,
    description: "Compact, high-quality embeddings from Google.",
  },
  {
    id: "google/gemini-embedding-exp-03-07",
    label: "gemini-embedding-exp-03-07",
    provider: "google",
    dimensions: 3072,
    maxInputTokens: 8192,
    description: "State-of-the-art Gemini embeddings with flexible dimensions.",
  },

  // ── Cohere ───────────────────────────────────────────────────────────
  {
    id: "cohere/embed-english-v3.0",
    label: "embed-english-v3.0",
    provider: "cohere",
    dimensions: 1024,
    maxInputTokens: 512,
    description: "Tuned for retrieval; great for English-heavy corpora.",
  },
  {
    id: "cohere/embed-multilingual-v3.0",
    label: "embed-multilingual-v3.0",
    provider: "cohere",
    dimensions: 1024,
    maxInputTokens: 512,
    description: "100+ language multilingual retrieval embeddings.",
  },

  // ── Voyage AI ────────────────────────────────────────────────────────
  {
    id: "voyage/voyage-3",
    label: "voyage-3",
    provider: "voyage",
    dimensions: 1024,
    maxInputTokens: 32000,
    description: "Voyage's best general-purpose retrieval model.",
  },
  {
    id: "voyage/voyage-3-lite",
    label: "voyage-3-lite",
    provider: "voyage",
    dimensions: 512,
    maxInputTokens: 32000,
    description: "Optimized for latency and cost with strong performance.",
  },
  {
    id: "voyage/voyage-code-3",
    label: "voyage-code-3",
    provider: "voyage",
    dimensions: 1024,
    maxInputTokens: 32000,
    description: "Specialized for code retrieval tasks.",
  },

  // ── Mistral ──────────────────────────────────────────────────────────
  {
    id: "mistral/mistral-embed",
    label: "mistral-embed",
    provider: "mistral",
    dimensions: 1024,
    maxInputTokens: 8192,
    description: "Mistral's efficient embedding model for retrieval.",
  },

  // ── Jina AI ──────────────────────────────────────────────────────────
  {
    id: "jina/jina-embeddings-v3",
    label: "jina-embeddings-v3",
    provider: "jina",
    dimensions: 1024,
    maxInputTokens: 8192,
    description: "Multilingual, task-specific embeddings from Jina AI.",
  },
  {
    id: "jina/jina-clip-v2",
    label: "jina-clip-v2",
    provider: "jina",
    dimensions: 1024,
    maxInputTokens: 8192,
    description: "Multimodal embeddings for text and images.",
  },

  // ── Nomic ────────────────────────────────────────────────────────────
  {
    id: "nomic/nomic-embed-text-v1.5",
    label: "nomic-embed-text-v1.5",
    provider: "nomic",
    dimensions: 768,
    maxInputTokens: 8192,
    description: "Open-source, highly capable text embeddings.",
  },
]

export function getEmbeddingModel(
  id: string,
): EmbeddingModelDescriptor | undefined {
  return EMBEDDING_MODELS.find((m) => m.id === id)
}
