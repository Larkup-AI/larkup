import type { EmbeddingModelDescriptor } from "../types"
import type { GatewayModel } from "../models-cache"

/**
 * Dimensions lookup for known embedding models.
 * The Vercel AI Gateway provides model lists but not dimension metadata,
 * so we enrich dynamically-fetched models with this lookup.
 */
export const EMBEDDING_DIMENSIONS: Record<string, { dimensions: number; maxInputTokens: number }> = {
  // OpenAI
  "openai/text-embedding-3-small": { dimensions: 1536, maxInputTokens: 8191 },
  "openai/text-embedding-3-large": { dimensions: 3072, maxInputTokens: 8191 },
  "openai/text-embedding-ada-002": { dimensions: 1536, maxInputTokens: 8191 },
  // Google

  "google/gemini-embedding-2": { dimensions: 768, maxInputTokens: 2048 },
  "google/gemini-embedding-001": { dimensions: 768, maxInputTokens: 2048 },
  // Cohere
  "cohere/embed-english-v3.0": { dimensions: 1024, maxInputTokens: 512 },
  "cohere/embed-multilingual-v3.0": { dimensions: 1024, maxInputTokens: 512 },
  // Voyage
  "voyage/voyage-3": { dimensions: 1024, maxInputTokens: 32000 },
  "voyage/voyage-3-lite": { dimensions: 512, maxInputTokens: 32000 },
  "voyage/voyage-code-3": { dimensions: 1024, maxInputTokens: 32000 },
  // Mistral
  "mistral/mistral-embed": { dimensions: 1024, maxInputTokens: 8192 },
  // Jina
  "jina/jina-embeddings-v3": { dimensions: 1024, maxInputTokens: 8192 },
  "jina/jina-clip-v2": { dimensions: 1024, maxInputTokens: 8192 },
  // Nomic
  "nomic/nomic-embed-text-v1.5": { dimensions: 768, maxInputTokens: 8192 },
}

/**
 * Convert a GatewayModel (type "embedding") to an EmbeddingModelDescriptor.
 * Enriches with known dimensions or uses a sensible default.
 */
export function toEmbeddingDescriptor(m: GatewayModel): EmbeddingModelDescriptor {
  const known = EMBEDDING_DIMENSIONS[m.id]
  const provider = m.id.split("/")[0] || m.owned_by
  return {
    id: m.id,
    label: m.name || m.id.split("/").slice(1).join("/"),
    provider: provider as any,
    dimensions: known?.dimensions ?? m.context_window ?? 768,
    maxInputTokens: known?.maxInputTokens ?? m.max_tokens ?? 2048,
    description: m.description || "",
  }
}

/**
 * Filter embedding models for a specific provider.
 * If provider is "vercel_ai_gateway", returns all models.
 */
export function getEmbeddingModelsForProvider(
  models: EmbeddingModelDescriptor[],
  provider: string,
): EmbeddingModelDescriptor[] {
  if (provider === "vercel_ai_gateway") return models
  return models.filter((m) => m.provider?.toLowerCase() === provider.toLowerCase())
}

/**
 * Hardcoded fallback embedding models — only GA (generally available) models.
 * Used when the gateway is unreachable.
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
    id: "google/gemini-embedding-001",
    label: "gemini-embedding-001",
    provider: "google",
    dimensions: 768,
    maxInputTokens: 2048,
    description: "Gemini embedding 001.",
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
