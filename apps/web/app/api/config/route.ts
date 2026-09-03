import { NextResponse } from 'next/server';
import { readConfig, writeConfig } from '@larkup/core/config-store';
import { getVectorStore, validateStoreConfig } from '@larkup/vector-stores/registry';
import { getSandboxProvider, validateSandboxCredentials } from '@larkup/sandbox/registry';
import { getEmbeddingModel } from '@larkup/core/embeddings/registry';
import { getAllModels } from '@larkup/core/models-cache';
import {
  getChatModelsForProvider,
  normalizeNativeChatModelId,
  toChatDescriptor,
} from '@larkup/core/chat-models/registry';
import { runWithProject } from '@larkup/core/project-store';
import type { RagConfig } from '@larkup/core/types';
import { getToolById } from '@larkup/marketplace/registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function withProject<T>(projectId: string | null, fn: () => Promise<T>) {
  return projectId ? runWithProject(projectId, fn) : fn();
}

function imageIndexingCapability(
  config: RagConfig,
  models: Awaited<ReturnType<typeof getAllModels>>,
) {
  const provider =
    config.visionProvider || config.chatProvider || config.embeddingProvider || 'openai';
  const selectedModelId = config.visionModelId?.trim();

  if (selectedModelId?.startsWith('custom:')) {
    const modelName = selectedModelId.slice('custom:'.length);
    const available = Boolean(
      config.customVisionModels?.some((model) => model.modelName === modelName),
    );
    return {
      available,
      message: available
        ? undefined
        : 'The selected custom vision model is no longer configured. PDF images will not be indexed.',
    };
  }

  const languageModels = models.filter((model) => model.type === 'language').map(toChatDescriptor);
  const visionModels = getChatModelsForProvider(languageModels, provider).filter((model) =>
    model.tags?.includes('vision'),
  );
  const available = selectedModelId
    ? visionModels.some((model) => model.id === selectedModelId)
    : visionModels.length > 0;

  return {
    available,
    message: available
      ? undefined
      : `No vision-capable model is available from ${provider}. PDF images will not be indexed.`,
  };
}

/** Config field keys a tool's own backend provisions (e.g. device credentials), per this tool's manifest. */
async function serverManagedConfigKeys(toolId: string): Promise<string[]> {
  const descriptor = await getToolById(toolId);
  return (descriptor?.configSchema ?? [])
    .filter((field) => field.serverManaged)
    .map((field) => field.key);
}

/**
 * Strips server-managed fields (e.g. a tool's provisioned device key) from
 * every tool's config before it reaches the client, and redacts Enterprise
 * gateway credentials, which are managed by the private control plane.
 */
async function configForClient(config: RagConfig): Promise<RagConfig> {
  const toolConfigs = { ...(config.toolConfigs ?? {}) };
  for (const toolId of Object.keys(toolConfigs)) {
    const managedKeys = await serverManagedConfigKeys(toolId);
    if (managedKeys.length === 0) continue;
    const toolConfig = { ...toolConfigs[toolId] };
    for (const key of managedKeys) delete toolConfig[key];
    toolConfigs[toolId] = toolConfig;
  }
  const safeConfig: RagConfig = {
    ...config,
    toolConfigs,
  };
  if (!config.enterprise) return safeConfig;
  return {
    ...safeConfig,
    embeddingApiKey: '',
    chatApiKey: '',
    visionApiKey: '',
    customEmbeddings: config.customEmbeddings?.map((model) => ({ ...model, apiKey: undefined })),
    customChatModels: config.customChatModels?.map((model) => ({ ...model, apiKey: undefined })),
    customVisionModels: config.customVisionModels?.map((model) => ({
      ...model,
      apiKey: undefined,
    })),
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId') ?? url.searchParams.get('serverId');
  return withProject(projectId, async () => {
    const [config, models] = await Promise.all([readConfig(), getAllModels()]);
    return NextResponse.json({
      config: await configForClient(config),
      capabilities: { imageIndexing: imageIndexingCapability(config, models) },
    });
  });
}

export async function PUT(request: Request) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId') ?? url.searchParams.get('serverId');
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

  // Validate the selected sandbox provider's credentials, if it needs any.
  const sandboxProviderId = body.defaultSandboxProvider;
  if (sandboxProviderId && sandboxProviderId !== 'local' && sandboxProviderId !== 'docker') {
    const sandboxProvider = getSandboxProvider(
      sandboxProviderId as Parameters<typeof getSandboxProvider>[0],
    );
    if (!sandboxProvider) {
      return NextResponse.json(
        { error: `Unknown sandbox provider: ${sandboxProviderId}` },
        { status: 400 },
      );
    }
    if (sandboxProvider.executionSupport !== 'full') {
      return NextResponse.json(
        { error: `${sandboxProvider.label} cannot run general code execution.` },
        { status: 422 },
      );
    }
    const sandboxFieldErrors = validateSandboxCredentials(
      sandboxProvider,
      body.sandboxProviderConfigs?.[sandboxProviderId] ?? {},
    );
    if (Object.keys(sandboxFieldErrors).length > 0) {
      return NextResponse.json(
        { error: 'Missing required sandbox provider fields', fieldErrors: sandboxFieldErrors },
        { status: 422 },
      );
    }
  }

  return withProject(projectId, async () => {
    const current = await readConfig();
    const currentToolConfigs = current.toolConfigs ?? {};
    const mergedToolConfigs = { ...(body.toolConfigs ?? {}) };
    for (const toolId of Object.keys(currentToolConfigs)) {
      const managedKeys = await serverManagedConfigKeys(toolId);
      if (managedKeys.length === 0) continue;
      const currentToolConfig = currentToolConfigs[toolId] ?? {};
      const nextToolConfig = { ...(mergedToolConfigs[toolId] ?? {}) };
      for (const key of managedKeys) {
        if (key in currentToolConfig) nextToolConfig[key] = currentToolConfig[key];
      }
      mergedToolConfigs[toolId] = nextToolConfig;
    }
    const bodyWithManagedConnection = { ...body, toolConfigs: mergedToolConfigs };
    const saved = await writeConfig(
      current.enterprise
        ? {
            ...bodyWithManagedConnection,
            chatApiKey: current.chatApiKey,
            embeddingApiKey: current.embeddingApiKey,
            visionApiKey: current.visionApiKey,
            customEmbeddings: current.customEmbeddings,
            customChatModels: current.customChatModels,
            customVisionModels: current.customVisionModels,
            enterprise: current.enterprise,
          }
        : bodyWithManagedConnection,
    );
    return NextResponse.json({ config: await configForClient(saved) });
  });
}
