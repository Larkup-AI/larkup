import type { GatewayModel } from '../models-cache';

export interface ChatModelDescriptor {
  id: string;
  name: string;
  provider: string;
  context_window?: number;
  max_tokens?: number;
  tags?: string[];
  description?: string;
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
  };
}

/** Filter chat models for a provider from a dynamic list. */
export function getChatModelsForProvider(
  models: ChatModelDescriptor[],
  provider: string,
): ChatModelDescriptor[] {
  if (provider === 'vercel_ai_gateway') return models;
  return models.filter((m) => m.provider?.toLowerCase() === provider.toLowerCase());
}

/** Pick a sensible default model for a provider. */
export function getDefaultChatModel(
  models: ChatModelDescriptor[],
  provider: string,
): ChatModelDescriptor | undefined {
  const forProvider = getChatModelsForProvider(models, provider);
  const defaults: Record<string, string> = {
    openai: 'openai/gpt-5',
    anthropic: 'anthropic/claude-3.5-sonnet-latest',
    google: 'google/gemini-2.5-pro',
    mistral: 'mistral/mistral-large-latest',
    deepseek: 'deepseek/deepseek-chat',
    cohere: 'cohere/command-r-plus',
    meta: 'meta/llama-4-maverick',
    xai: 'xai/grok-3-mini',
    vercel_ai_gateway: 'anthropic/claude-3.5-sonnet-latest',
  };
  const defaultId = defaults[provider];
  return forProvider.find((m) => m.id === defaultId) ?? forProvider[0];
}

/**
 * Picks a vision-capable model for a provider. This is deliberately separate
 * from the chat default because a text-only provider must never be selected
 * for a frame, OCR, or image-analysis task.
 */
export function getDefaultVisionModel(
  models: ChatModelDescriptor[],
  provider: string,
): ChatModelDescriptor | undefined {
  const visionModels = models.filter((model) => model.tags?.includes('vision'));
  const candidates =
    provider === 'vercel_ai_gateway'
      ? visionModels
      : visionModels.filter((model) => model.provider?.toLowerCase() === provider.toLowerCase());
  const defaults: Record<string, string> = {
    vercel_ai_gateway: 'openai/gpt-4o-mini',
    openai: 'openai/gpt-4o-mini',
    google: 'google/gemini-2.5-flash',
    mistral: 'mistral/pixtral-12b',
  };
  return candidates.find((model) => model.id === defaults[provider]) ?? candidates[0];
}

/** Find a specific model by id. */
export function getChatModel(
  models: ChatModelDescriptor[],
  id: string,
): ChatModelDescriptor | undefined {
  return models.find((m) => m.id === id);
}
