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

/**
 * Models exposed by the native Gemini API for a new API key. Keep this list
 * separate from the gateway catalog: gateway aliases and retired Gemini
 * versions are not necessarily available through Google's direct API.
 *
 * All entries support function calling, including parallel calls, which is
 * required by the Larkup chat tool loop.
 */
export const GOOGLE_NATIVE_CHAT_MODELS: ChatModelDescriptor[] = [
  {
    id: 'google/gemini-3.6-flash',
    name: 'Gemini 3.6 Flash',
    provider: 'google',
    context_window: 1_000_000,
    max_tokens: 65_536,
    tags: ['vision', 'reasoning', 'tool-use', 'file-input', 'web-search'],
  },
  {
    id: 'google/gemini-3.5-flash',
    name: 'Gemini 3.5 Flash',
    provider: 'google',
    context_window: 1_000_000,
    max_tokens: 65_536,
    tags: ['vision', 'reasoning', 'tool-use', 'file-input', 'web-search'],
  },
  {
    id: 'google/gemini-3.5-flash-lite',
    name: 'Gemini 3.5 Flash-Lite',
    provider: 'google',
    context_window: 1_000_000,
    max_tokens: 65_536,
    tags: ['vision', 'reasoning', 'tool-use', 'file-input'],
  },
  {
    id: 'google/gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro Preview',
    provider: 'google',
    context_window: 1_000_000,
    max_tokens: 65_536,
    tags: ['vision', 'reasoning', 'tool-use', 'file-input', 'web-search'],
  },
  {
    id: 'google/gemini-3.1-flash-lite',
    name: 'Gemini 3.1 Flash-Lite',
    provider: 'google',
    context_window: 1_000_000,
    max_tokens: 65_536,
    tags: ['vision', 'reasoning', 'tool-use', 'file-input', 'web-search'],
  },
  {
    id: 'google/gemini-3-flash-preview',
    name: 'Gemini 3 Flash Preview',
    provider: 'google',
    context_window: 1_000_000,
    max_tokens: 65_536,
    tags: ['vision', 'reasoning', 'tool-use', 'file-input', 'web-search'],
  },
];

export const DEFAULT_NATIVE_CHAT_MODELS: Record<string, string> = {
  openai: 'openai/gpt-5',
  anthropic: 'anthropic/claude-sonnet-4',
  google: 'google/gemini-3.6-flash',
  mistral: 'mistral/mistral-large-3',
  deepseek: 'deepseek/deepseek-v3.2',
  cohere: 'cohere/command-a',
};

export function isNativeChatModel(provider: string, modelId: string): boolean {
  if (provider === 'vercel_ai_gateway') return true;
  if (provider === 'custom') return modelId.startsWith('custom:');
  if (provider === 'google') {
    return GOOGLE_NATIVE_CHAT_MODELS.some((model) => model.id === modelId);
  }
  return modelId.startsWith(`${provider}/`) || !modelId.includes('/');
}

/** Replace retired native Gemini selections saved by older Larkup versions. */
export function normalizeNativeChatModelId(provider: string, modelId?: string): string | undefined {
  if (!modelId || provider !== 'google') return modelId;
  return isNativeChatModel(provider, modelId) ? modelId : DEFAULT_NATIVE_CHAT_MODELS.google;
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
  if (provider === 'google') return GOOGLE_NATIVE_CHAT_MODELS;
  return models.filter(
    (m) => m.provider?.toLowerCase() === provider.toLowerCase() && m.tags?.includes('tool-use'),
  );
}

/** Pick a sensible default model for a provider. */
export function getDefaultChatModel(
  models: ChatModelDescriptor[],
  provider: string,
): ChatModelDescriptor | undefined {
  const forProvider = getChatModelsForProvider(models, provider);
  const defaults: Record<string, string> = {
    ...DEFAULT_NATIVE_CHAT_MODELS,
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
  const candidates = getChatModelsForProvider(models, provider).filter((model) =>
    model.tags?.includes('vision'),
  );
  const defaults: Record<string, string> = {
    vercel_ai_gateway: 'openai/gpt-4o-mini',
    openai: 'openai/gpt-4o-mini',
    google: 'google/gemini-3.6-flash',
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
