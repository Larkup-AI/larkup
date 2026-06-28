import type { EmbeddingProvider } from "../types"

/**
 * A selectable chat/LLM model. Grouped by the same provider IDs used
 * for embeddings so we can auto-select a default based on the user's
 * chosen embedding provider.
 */
export interface ChatModelDescriptor {
  /** AI SDK model string, e.g. "openai/gpt-4o-mini" */
  id: string
  label: string
  provider: EmbeddingProvider
  /** Whether this is the default (cheapest) model for its provider */
  isDefault?: boolean
  description: string
}

export const CHAT_MODELS: ChatModelDescriptor[] = [
  // ── OpenAI ──────────────────────────────────────────────────────────
  {
    id: "openai/gpt-4o-mini",
    label: "GPT-4o Mini",
    provider: "openai",
    isDefault: true,
    description: "Fast and affordable. Great for most chat use cases.",
  },
  {
    id: "openai/gpt-4o",
    label: "GPT-4o",
    provider: "openai",
    description: "Most capable OpenAI model. Higher cost.",
  },
  {
    id: "openai/gpt-4.1-mini",
    label: "GPT-4.1 Mini",
    provider: "openai",
    description: "Latest mini model with improved instruction following.",
  },
  {
    id: "openai/gpt-4.1-nano",
    label: "GPT-4.1 Nano",
    provider: "openai",
    description: "Smallest and fastest GPT-4.1 variant.",
  },

  // ── Google ──────────────────────────────────────────────────────────
  {
    id: "google/gemini-2.0-flash",
    label: "Gemini 2.0 Flash",
    provider: "google",
    isDefault: true,
    description: "Fast, affordable Gemini model. Great default.",
  },
  {
    id: "google/gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    provider: "google",
    description: "Latest Gemini flash with improved reasoning.",
  },
  {
    id: "google/gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    provider: "google",
    description: "Most capable Gemini model.",
  },

  // ── Cohere ──────────────────────────────────────────────────────────
  {
    id: "cohere/command-r",
    label: "Command R",
    provider: "cohere",
    isDefault: true,
    description: "Optimized for RAG and tool use.",
  },
  {
    id: "cohere/command-r-plus",
    label: "Command R+",
    provider: "cohere",
    description: "Most capable Cohere model for complex tasks.",
  },

  // ── Mistral ─────────────────────────────────────────────────────────
  {
    id: "mistral/mistral-small-latest",
    label: "Mistral Small",
    provider: "mistral",
    isDefault: true,
    description: "Fast and efficient. Good for most tasks.",
  },
  {
    id: "mistral/mistral-large-latest",
    label: "Mistral Large",
    provider: "mistral",
    description: "Mistral's most capable model.",
  },

  // ── DeepSeek ────────────────────────────────────────────────────────
  {
    id: "deepseek/deepseek-chat",
    label: "DeepSeek Chat",
    provider: "deepseek",
    isDefault: true,
    description: "DeepSeek's primary chat model.",
  },

  // ── Vercel AI Gateway ───────────────────────────────────────────────
  {
    id: "openai/gpt-4o-mini",
    label: "GPT-4o Mini (via Gateway)",
    provider: "vercel_ai_gateway",
    isDefault: true,
    description: "OpenAI GPT-4o Mini routed through Vercel AI Gateway.",
  },
  {
    id: "google/gemini-2.0-flash",
    label: "Gemini 2.0 Flash (via Gateway)",
    provider: "vercel_ai_gateway",
    description: "Google Gemini routed through Vercel AI Gateway.",
  },
]

/** Get all chat models for a given embedding provider. */
export function getChatModelsForProvider(provider: string): ChatModelDescriptor[] {
  return CHAT_MODELS.filter((m) => m.provider === provider)
}

/** Get the default (cheapest) chat model for a provider. */
export function getDefaultChatModel(provider: string): ChatModelDescriptor | undefined {
  return (
    CHAT_MODELS.find((m) => m.provider === provider && m.isDefault) ??
    CHAT_MODELS.find((m) => m.provider === provider)
  )
}

/** Find a specific chat model by id. */
export function getChatModel(id: string): ChatModelDescriptor | undefined {
  return CHAT_MODELS.find((m) => m.id === id)
}
