import type { RagConfig } from './types';
import { getModelsByType } from './models-cache';
import {
  toChatDescriptor,
  getChatModelsForProvider,
  getDefaultChatModel,
  getVisionModelsForProvider,
} from './chat-models/registry';
import {
  toEmbeddingDescriptor,
  getEmbeddingModelsForProvider,
  EMBEDDING_MODELS,
} from './embeddings/registry';

export async function workspaceModelStatus(
  config: RagConfig,
  indexed: boolean,
  requestedProvider?: string | null,
) {
  const hasApiKey = !!(config.chatApiKey || config.embeddingApiKey);

  const blockers: string[] = [];
  if (!hasApiKey) {
    blockers.push('Connect a chat model in Settings to start chatting.');
  }

  const provider = requestedProvider || config.chatProvider || config.embeddingProvider;

  // Fetch dynamic models from gateway cache
  const [languageModels, embeddingGatewayModels] = await Promise.all([
    getModelsByType('language'),
    getModelsByType('embedding'),
  ]);

  // Chat models.
  const allChatModels = languageModels.map(toChatDescriptor);
  const chatModels = getChatModelsForProvider(allChatModels, provider);

  if (provider === 'custom' && config.customChatModels) {
    chatModels.push(
      ...config.customChatModels.map((m) => ({
        id: `custom:${m.modelName}`,
        name: m.modelName,
        provider: 'custom',
        tags: ['custom'],
      })),
    );
  }

  const defaultModel = getDefaultChatModel(allChatModels, provider);
  const chatModelId =
    config.chatModelId ||
    (provider === 'custom' && config.customChatModels?.[0]
      ? `custom:${config.customChatModels[0].modelName}`
      : defaultModel?.id) ||
    'openai/gpt-4o-mini';

  // Embedding models.
  const dynamicEmbeddingModels = embeddingGatewayModels.map(toEmbeddingDescriptor);

  const embeddingIds = new Set(dynamicEmbeddingModels.map((m) => m.id));
  const mergedEmbeddings = [
    ...dynamicEmbeddingModels,
    ...EMBEDDING_MODELS.filter((m) => !embeddingIds.has(m.id)),
  ];

  // Filter for the requested embedding provider
  const embeddingProvider = config.embeddingProvider || provider;
  const embeddingModels = getEmbeddingModelsForProvider(mergedEmbeddings, embeddingProvider);

  return {
    ready: hasApiKey,
    indexed,
    blockers,
    provider,
    chatModelId,
    availableModels: chatModels.map((m) => ({
      id: m.id,
      label: m.name,
      provider: m.provider,
      context_window: m.context_window,
      tags: m.tags,
    })),
    // Keep this workspace-wide list separate from the chat provider list.
    // `availableFrom` preserves the provider/model compatibility that was
    // lost when native and Gateway catalogs were previously merged.
    availableVisionModels: [
      ...getVisionModelsForProvider(allChatModels, 'vercel_ai_gateway').map((m) => ({
        id: m.id,
        label: m.name,
        provider: m.provider,
        availableFrom: ['vercel_ai_gateway', ...(m.provider === 'google' ? [] : [m.provider])],
        context_window: m.context_window,
        tags: m.tags,
      })),
      ...getVisionModelsForProvider(allChatModels, 'google').map((m) => ({
        id: m.id,
        label: m.name,
        provider: m.provider,
        availableFrom: ['google'],
        context_window: m.context_window,
        tags: m.tags,
      })),
    ],
    availableEmbeddingModels: mergedEmbeddings.map((m) => ({
      id: m.id,
      label: m.label,
      provider: m.provider,
      dimensions: m.dimensions,
      maxInputTokens: m.maxInputTokens,
      description: m.description,
    })),
  };
}
