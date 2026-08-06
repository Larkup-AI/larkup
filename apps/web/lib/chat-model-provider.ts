import { createAnthropic } from '@ai-sdk/anthropic';
import { createCohere } from '@ai-sdk/cohere';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createGateway } from '@ai-sdk/gateway';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createMistral } from '@ai-sdk/mistral';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import {
  getDefaultChatModel,
  getDefaultVisionModel,
  toChatDescriptor,
} from '@larkup/core/chat-models/registry';
import type { GatewayModel } from '@larkup/core/models-cache';
import type { CustomModelConfig, RagConfig } from '@larkup/core/types';

const FALLBACK_CHAT_MODELS: Record<string, string> = {
  openai: 'openai/gpt-4o-mini',
  anthropic: 'anthropic/claude-3-5-sonnet-latest',
  google: 'google/gemini-2.5-flash',
  cohere: 'cohere/command-r-plus',
  mistral: 'mistral/mistral-large-latest',
  deepseek: 'deepseek/deepseek-chat',
};

export interface ResolvedChatModel {
  provider: string;
  modelId: string;
  apiKey?: string;
}

export interface ResolveChatModelOptions {
  requiredTag?: string;
}

/**
 * Resolve an LLM from persisted settings. The configured provider is
 * authoritative: a gateway key must never be passed to a model vendor SDK.
 */
export function resolveConfiguredChatModel(
  config: RagConfig,
  availableModels: GatewayModel[] = [],
  options: ResolveChatModelOptions = {},
): ResolvedChatModel {
  const provider = config.chatProvider || config.embeddingProvider || 'openai';
  let modelId = config.chatModelId?.trim();

  if (!modelId && provider === 'custom' && config.customChatModels?.[0]) {
    modelId = `custom:${config.customChatModels[0].modelName}`;
  }

  if (!modelId && availableModels.length > 0) {
    const requiredTag = options.requiredTag;
    const taggedModels = requiredTag
      ? availableModels.filter((model) => model.tags?.includes(requiredTag))
      : availableModels;
    const candidates = taggedModels.length > 0 ? taggedModels : availableModels;
    modelId = getDefaultChatModel(candidates.map(toChatDescriptor), provider)?.id;
  }

  if (!modelId && provider === 'vercel_ai_gateway') {
    throw new Error('No gateway model is available. Choose a chat model before processing media.');
  }

  modelId ||= FALLBACK_CHAT_MODELS[provider] || FALLBACK_CHAT_MODELS.openai;

  return {
    provider,
    modelId,
    apiKey: config.chatApiKey || config.embeddingApiKey || undefined,
  };
}

/**
 * Resolve the workspace-wide vision-language model. Image-capable tools share
 * this setting so they do not accidentally run on a text-only chat model.
 */
export function resolveConfiguredVisionModel(
  config: RagConfig,
  availableModels: GatewayModel[] = [],
): ResolvedChatModel {
  const provider =
    config.visionProvider || config.chatProvider || config.embeddingProvider || 'openai';
  let modelId = config.visionModelId?.trim();
  const customModels = config.customVisionModels ?? [];

  if (!modelId && provider === 'custom' && customModels[0]) {
    modelId = `custom:${customModels[0].modelName}`;
  }

  if (!modelId) {
    modelId = getDefaultVisionModel(availableModels.map(toChatDescriptor), provider)?.id;
  }

  if (!modelId) {
    throw new Error(
      `No vision-capable model is available for ${provider}. Configure a Vision Model in Settings → AI Models.`,
    );
  }

  const chatProvider = config.chatProvider || config.embeddingProvider;
  const apiKey =
    config.visionApiKey ||
    (provider === chatProvider ? config.chatApiKey : undefined) ||
    (provider === config.embeddingProvider ? config.embeddingApiKey : undefined);

  return { provider, modelId, apiKey };
}

export function createChatModel(
  provider: string,
  modelId: string,
  apiKey?: string,
  customChatModels: CustomModelConfig[] = [],
) {
  if (modelId.startsWith('custom:')) {
    const customName = modelId.slice('custom:'.length);
    const custom = customChatModels.find((candidate) => candidate.modelName === customName);
    if (!custom) {
      throw new Error(`Custom chat model "${customName}" is not configured.`);
    }

    const customProvider = createOpenAICompatible({
      name: 'custom_chat_provider',
      baseURL: custom.baseUrl,
      apiKey: custom.apiKey || apiKey || undefined,
    });
    return customProvider(custom.modelName);
  }

  const modelName = modelId.includes('/') ? modelId.split('/').slice(1).join('/') : modelId;

  switch (provider) {
    case 'google':
      return createGoogleGenerativeAI({ apiKey })(modelName);
    case 'cohere':
      return createCohere({ apiKey })(modelName);
    case 'mistral':
      return createMistral({ apiKey })(modelName);
    case 'deepseek':
      return createDeepSeek({ apiKey })(modelName);
    case 'anthropic':
      return createAnthropic({ apiKey })(modelName);
    case 'openai':
      return createOpenAI({ apiKey })(modelName);
    case 'vercel_ai_gateway':
      // Gateway model IDs retain their vendor prefix (for example,
      // "openai/gpt-4o-mini") because routing happens at the gateway.
      return createGateway({ apiKey })(modelId);
    case 'custom':
      throw new Error('Choose a configured custom chat model before processing media.');
    default:
      throw new Error(`Unsupported chat provider "${provider}".`);
  }
}
