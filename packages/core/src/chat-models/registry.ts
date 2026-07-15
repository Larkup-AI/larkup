import type { GatewayModel } from "../models-cache"

export interface ChatModelDescriptor {
  id: string
  name: string
  provider: string
  context_window?: number
  max_tokens?: number
  tags?: string[]
  description?: string
}

/** Convert a GatewayModel to a ChatModelDescriptor */
export function toChatDescriptor(m: GatewayModel): ChatModelDescriptor {
  return {
    id: m.id,
    name: m.name,
    provider: m.owned_by,
    context_window: m.context_window,
    max_tokens: m.max_tokens,
    tags: m.tags,
    description: m.description,
  }
}

/** Filter chat models for a provider from a dynamic list. */
export function getChatModelsForProvider(
  models: ChatModelDescriptor[],
  provider: string,
): ChatModelDescriptor[] {
  if (provider === "vercel_ai_gateway") return models
  return models.filter((m) => m.provider?.toLowerCase() === provider.toLowerCase())
}

/** Pick a sensible default model for a provider. */
export function getDefaultChatModel(
  models: ChatModelDescriptor[],
  provider: string,
): ChatModelDescriptor | undefined {
  const forProvider = getChatModelsForProvider(models, provider)
  // Prefer known good defaults
  const defaults: Record<string, string> = {
    openai: "openai/gpt-4o-mini",
    anthropic: "anthropic/claude-sonnet-4",
    google: "google/gemini-2.0-flash",
    mistral: "mistral/mistral-small-latest",
    deepseek: "deepseek/deepseek-chat",
    cohere: "cohere/command-r",
    meta: "meta/llama-4-maverick",
    xai: "xai/grok-3-mini",
    vercel_ai_gateway: "openai/gpt-4o-mini",
  }
  const defaultId = defaults[provider]
  return forProvider.find((m) => m.id === defaultId) ?? forProvider[0]
}

/** Find a specific model by id. */
export function getChatModel(
  models: ChatModelDescriptor[],
  id: string,
): ChatModelDescriptor | undefined {
  return models.find((m) => m.id === id)
}
