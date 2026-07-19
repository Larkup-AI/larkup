import { NextResponse } from 'next/server';
import { readConfig, writeConfig } from '@larkup/core/config-store';
import { readRun } from '@larkup/core/index-store';
import { runWithServer } from '@larkup/core/workspace';
import { createAdapter } from '@larkup/vector-stores/factory';
import { embedQuery } from '@larkup/core/indexing/embedder';
import { generateObject } from 'ai';
import { z } from 'zod';
import { getChatModel, toChatDescriptor } from '@larkup/core/chat-models/registry';
import { getModelsByType } from '@larkup/core/models-cache';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createCohere } from '@ai-sdk/cohere';
import { createMistral } from '@ai-sdk/mistral';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createGateway } from '@ai-sdk/gateway';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { CustomModelConfig } from '@larkup/core/types';

export const dynamic = 'force-dynamic';

function withServer<T>(serverId: string | null, fn: () => Promise<T>) {
  return serverId ? runWithServer(serverId, fn) : fn();
}

function createChatModel(
  provider: string,
  modelId: string,
  apiKey?: string,
  customChatModels?: CustomModelConfig[],
) {
  if (modelId.startsWith('custom:')) {
    const customName = modelId.slice('custom:'.length);
    const custom = (customChatModels ?? []).find((m) => m.modelName === customName);
    if (custom) {
      const customProvider = createOpenAICompatible({
        name: 'custom_chat_provider',
        baseURL: custom.baseUrl,
        apiKey: custom.apiKey || apiKey || undefined,
      });
      return customProvider(custom.modelName);
    }
  }

  const modelName = modelId.includes('/') ? modelId.split('/').slice(1).join('/') : modelId;
  const key = apiKey;

  switch (provider) {
    case 'google':
      return createGoogleGenerativeAI({ apiKey: key })(modelName);
    case 'cohere':
      return createCohere({ apiKey: key })(modelName);
    case 'mistral':
      return createMistral({ apiKey: key })(modelName);
    case 'deepseek':
      return createDeepSeek({ apiKey: key })(modelName);
    case 'vercel_ai_gateway':
      return createGateway({ apiKey: key })(modelId);
    case 'openai':
    default:
      return createOpenAI({ apiKey: key })(modelName);
  }
}

export async function POST(req: Request) {
  const serverId = new URL(req.url).searchParams.get('serverId');
  return withServer(serverId, async () => {
    const config = await readConfig();
    const run = await readRun();

    if (config.chatSuggestions && config.chatSuggestions.length > 0) {
      return NextResponse.json({ suggestions: config.chatSuggestions });
    }

    const indexed = run?.status === 'completed' && (run.totalChunks ?? 0) > 0;
    if (!indexed) {
      return NextResponse.json({
        suggestions: ['What is this corpus about?', 'Summarize the key concepts'],
      });
    }

    try {
      const vector = await embedQuery(config, 'overview summary');
      const adapter = await createAdapter(config);
      const hits = await adapter.query(vector, 5, 'overview summary');

      const context = hits
        ?.map((h) => h.text)
        ?.join('\n\n')
        ?.slice(0, 3000);

      const provider = config.chatProvider || config.embeddingProvider;
      const chatModelId = config.chatModelId || 'openai/gpt-4o-mini';
      const gatewayModels = await getModelsByType('language');
      const allChatModels = gatewayModels.map(toChatDescriptor);
      const descriptor = getChatModel(allChatModels, chatModelId);
      const resolvedProvider =
        provider === 'vercel_ai_gateway' ? 'vercel_ai_gateway' : descriptor?.provider || provider;

      const aiModel = createChatModel(
        resolvedProvider,
        chatModelId,
        config.chatApiKey || config.embeddingApiKey,
        config.customChatModels,
      ) as any;

      const { object } = await generateObject({
        model: aiModel,
        system:
          'You are an AI that suggests 3 very short and concise questions a user could ask based on the provided text.',
        prompt: `Text:\n${context}`,
        schema: z.object({
          suggestions: z.array(z.string()).length(3),
        }),
      });

      config.chatSuggestions = object.suggestions;
      await writeConfig(config);

      return NextResponse.json({ suggestions: object.suggestions });
    } catch (e: any) {
      console.error('Failed to generate suggestions:', e.message);
      return NextResponse.json({
        suggestions: ['What is this corpus about?', 'Summarize the key concepts'],
      });
    }
  });
}
