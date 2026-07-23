import { NextResponse } from 'next/server';
import { generateText } from 'ai';
import { readConfig } from '@larkup/core/config-store';
import { getModelsByType } from '@larkup/core/models-cache';
import { toChatDescriptor } from '@larkup/core/chat-models/registry';

import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createCohere } from '@ai-sdk/cohere';
import { createMistral } from '@ai-sdk/mistral';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGateway } from '@ai-sdk/gateway';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

function createChatModel(
  provider: string,
  modelId: string,
  apiKey?: string,
  customChatModels?: any[],
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
    default:
      return createGateway({ apiKey })(modelId);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { base64, base64Images, prompt } = (await req.json()) as {
      base64?: string;
      base64Images?: string[];
      prompt?: string;
    };
    const images = (base64Images?.length ? base64Images : base64 ? [base64] : []).slice(0, 6);
    if (images.length === 0) {
      return NextResponse.json({ error: 'Missing image data' }, { status: 400 });
    }

    const config = await readConfig();
    const models = await getModelsByType('language');
    // Find a vision-capable model (default to whatever the user has, but prefer strong ones)
    const visionModelInfo =
      models.find(
        (m) => m.id.includes('gpt-4') || m.id.includes('claude-3-5') || m.id.includes('gemini-1.5'),
      ) || models[0];

    const modelDesc = toChatDescriptor(visionModelInfo);
    const apiKey = config.chatApiKey || config.embeddingApiKey || undefined;
    const model = createChatModel(
      modelDesc.provider,
      modelDesc.id,
      apiKey,
      config.customChatModels,
    ) as any;

    const defaultPrompt =
      'Provide a very brief, high-level summary of what this image contains (e.g., "A database ER diagram about films and actors", "A bar chart showing quarterly revenue"). Do NOT extract all text or exhaustively describe relationships. Keep it under 2 sentences.';

    const { text, usage } = await generateText({
      model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: prompt || defaultPrompt,
            },
            ...images.map((image) => ({
              type: 'image' as const,
              image: image.startsWith('data:') ? image : `data:image/jpeg;base64,${image}`,
            })),
          ],
        },
      ],
    });

    const { estimateCost, trackUsageEvent } = await import('@larkup/core/analytics-store');
    void trackUsageEvent({
      type: 'media_processing',
      mediaType: 'image',
      modelId: modelDesc.id,
      provider: modelDesc.provider,
      promptTokens: usage.inputTokens ?? 0,
      completionTokens: usage.outputTokens ?? 0,
      totalTokens: usage.totalTokens ?? 0,
      estimatedCost: estimateCost(modelDesc.id, usage.inputTokens ?? 0, usage.outputTokens ?? 0),
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json({ description: text });
  } catch (err: any) {
    console.error('Image description failed:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
