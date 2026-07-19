import { NextResponse } from 'next/server';
import { readConfig } from '@larkup/core/config-store';
import { readRun } from '@larkup/core/index-store';
import { runWithServer } from '@larkup/core/workspace';
import { getModelsByType } from '@larkup/core/models-cache';
import {
  toChatDescriptor,
  getChatModelsForProvider,
  getDefaultChatModel,
} from '@larkup/core/chat-models/registry';
import {
  toEmbeddingDescriptor,
  getEmbeddingModelsForProvider,
  EMBEDDING_MODELS,
} from '@larkup/core/embeddings/registry';

export const dynamic = 'force-dynamic';

function withServer<T>(serverId: string | null, fn: () => Promise<T>) {
  return serverId ? runWithServer(serverId, fn) : fn();
}

export async function GET(req: Request) {
  const serverId = new URL(req.url).searchParams.get('serverId');
  return withServer(serverId, async () => {
    const config = await readConfig();
    const run = await readRun();

    const indexed = run?.status === 'completed' && (run.totalChunks ?? 0) > 0;
    const hasApiKey = !!(config.chatApiKey || config.embeddingApiKey);

    const blockers: string[] = [];
    if (!hasApiKey) {
      blockers.push("You Can't start chatting.You have to set AI Models API Key in Settings.");
    }

    const requestedProvider = new URL(req.url).searchParams.get('provider');
    const provider = requestedProvider || config.chatProvider || config.embeddingProvider;

    // Fetch dynamic models from gateway cache
    const [languageModels, embeddingGatewayModels] = await Promise.all([
      getModelsByType('language'),
      getModelsByType('embedding'),
    ]);

    // ── Chat models ───────────────────────────────────────────────────
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

    // ── Embedding models ──────────────────────────────────────────────
    const dynamicEmbeddingModels = embeddingGatewayModels.map(toEmbeddingDescriptor);

    const embeddingIds = new Set(dynamicEmbeddingModels.map((m) => m.id));
    const mergedEmbeddings = [
      ...dynamicEmbeddingModels,
      ...EMBEDDING_MODELS.filter((m) => !embeddingIds.has(m.id)),
    ];

    // Filter for the requested embedding provider
    const embeddingProvider = config.embeddingProvider || provider;
    const embeddingModels = getEmbeddingModelsForProvider(mergedEmbeddings, embeddingProvider);

    return NextResponse.json({
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
      availableEmbeddingModels: mergedEmbeddings.map((m) => ({
        id: m.id,
        label: m.label,
        provider: m.provider,
        dimensions: m.dimensions,
        maxInputTokens: m.maxInputTokens,
        description: m.description,
      })),
      suggestions: config.chatSuggestions || [],
    });
  });
}
