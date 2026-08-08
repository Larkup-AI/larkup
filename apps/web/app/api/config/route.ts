import { NextResponse } from 'next/server';
import { readConfig, writeConfig } from '@larkup/core/config-store';
import { getVectorStore, validateStoreConfig } from '@larkup/vector-stores/registry';
import { getEmbeddingModel } from '@larkup/core/embeddings/registry';
import { getAllModels } from '@larkup/core/models-cache';
import {
  getChatModelsForProvider,
  normalizeNativeChatModelId,
  toChatDescriptor,
} from '@larkup/core/chat-models/registry';
import { runWithServer } from '@larkup/core/workspace';
import type { RagConfig } from '@larkup/core/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function withServer<T>(serverId: string | null, fn: () => Promise<T>) {
  return serverId ? runWithServer(serverId, fn) : fn();
}

export async function GET(request: Request) {
  const serverId = new URL(request.url).searchParams.get('serverId');
  return withServer(serverId, async () => {
    const config = await readConfig();
    return NextResponse.json({ config });
  });
}

export async function PUT(request: Request) {
  const serverId = new URL(request.url).searchParams.get('serverId');
  let body: RagConfig;
  try {
    body = (await request.json()) as RagConfig;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const defaultEmbeddingModels: Record<string, string> = {
    openai: 'openai/text-embedding-3-small',
    google: 'google/gemini-embedding-2',
    cohere: 'cohere/embed-english-v3.0',
    mistral: 'mistral/mistral-embed',
    vercel_ai_gateway: 'openai/text-embedding-3-small',
  };

  const resolvedEmbeddingProvider =
    body.embeddingProvider === 'vercel_ai_gateway' ? 'vercel_ai_gateway' : body.embeddingProvider;

  if (
    body.embeddingModelId &&
    resolvedEmbeddingProvider !== 'vercel_ai_gateway' &&
    resolvedEmbeddingProvider !== 'custom'
  ) {
    const modelInfo =
      getEmbeddingModel(body.embeddingModelId) ||
      getEmbeddingModel(`${resolvedEmbeddingProvider}/${body.embeddingModelId}`);

    if (modelInfo && modelInfo.provider !== resolvedEmbeddingProvider) {
      body.embeddingModelId =
        defaultEmbeddingModels[resolvedEmbeddingProvider] || defaultEmbeddingModels['openai'];
    }
  }

  if (body.chatProvider === 'google') {
    body.chatModelId = normalizeNativeChatModelId(body.chatProvider, body.chatModelId);
  }
  if (body.visionProvider === 'google') {
    body.visionModelId = normalizeNativeChatModelId(body.visionProvider, body.visionModelId);
  }

  // Validate the embedding model exists.
  const isCustom = body.embeddingModelId.startsWith('custom:');
  if (!isCustom && !getEmbeddingModel(body.embeddingModelId)) {
    return NextResponse.json(
      { error: `Unknown embedding model: ${body.embeddingModelId}` },
      { status: 400 },
    );
  }
  if (isCustom) {
    const modelName = body.embeddingModelId.slice('custom:'.length);
    const found = body.customEmbeddings?.find((m) => m.modelName === modelName);
    if (!found) {
      return NextResponse.json(
        { error: `Custom embedding model "${modelName}" not found in customEmbeddings` },
        { status: 400 },
      );
    }
  }

  // A configured vision model must be a model that accepts image input. The
  // provider remains independent from chat because media tools often need a
  // different capability or credential.
  if (body.visionProvider && !body.visionModelId && body.visionProvider !== 'custom') {
    const models = await getAllModels();
    const hasDefaultVisionModel =
      body.visionProvider === 'vercel_ai_gateway'
        ? models.some((model) => model.type === 'language' && model.tags?.includes('vision'))
        : getChatModelsForProvider(
            models.filter((model) => model.type === 'language').map(toChatDescriptor),
            body.visionProvider,
          ).some((model) => model.tags?.includes('vision'));
    if (!hasDefaultVisionModel) {
      return NextResponse.json(
        { error: `No vision-capable models are available from ${body.visionProvider}.` },
        { status: 400 },
      );
    }
  }

  if (body.visionModelId) {
    if (body.visionModelId.startsWith('custom:')) {
      const modelName = body.visionModelId.slice('custom:'.length);
      if (!body.customVisionModels?.some((model) => model.modelName === modelName)) {
        return NextResponse.json(
          { error: `Custom vision model "${modelName}" not found in customVisionModels` },
          { status: 400 },
        );
      }
    } else {
      const models = await getAllModels();
      const model = models.find((candidate) => candidate.id === body.visionModelId);
      const provider = body.visionProvider || body.chatProvider || body.embeddingProvider;
      const nativeModel = getChatModelsForProvider(
        models.filter((candidate) => candidate.type === 'language').map(toChatDescriptor),
        provider,
      ).find((candidate) => candidate.id === body.visionModelId);
      const providerMatches =
        provider === 'vercel_ai_gateway' ||
        model?.owned_by.toLowerCase() === provider?.toLowerCase() ||
        nativeModel?.provider === provider;
      if (
        (!model && !nativeModel) ||
        (model && model.type !== 'language') ||
        !(model?.tags?.includes('vision') || nativeModel?.tags?.includes('vision')) ||
        !providerMatches
      ) {
        return NextResponse.json(
          { error: `Vision model "${body.visionModelId}" is not available from ${provider}.` },
          { status: 400 },
        );
      }
    }
  }

  // Validate the store + its dynamic, store-specific fields.
  const store = getVectorStore(body.vectorStore);
  if (!store) {
    return NextResponse.json(
      { error: `Unknown vector store: ${body.vectorStore}` },
      { status: 400 },
    );
  }
  const fieldErrors = validateStoreConfig(store, body.storeConfig ?? {}, body.indexType);
  if (Object.keys(fieldErrors).length > 0) {
    return NextResponse.json(
      { error: 'Missing required vector store fields', fieldErrors },
      { status: 422 },
    );
  }

  return withServer(serverId, async () => {
    const saved = await writeConfig(body);
    return NextResponse.json({ config: saved });
  });
}
