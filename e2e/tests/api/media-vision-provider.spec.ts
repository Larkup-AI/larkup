import { expect, test } from '@playwright/test';
import type { GatewayModel } from '../../../packages/core/src/models-cache';
import type { RagConfig } from '../../../packages/core/src/types';
import {
  createChatModel,
  resolveConfiguredChatModel,
  resolveConfiguredVisionModel,
} from '../../../apps/web/lib/chat/model-provider';

const catalog: GatewayModel[] = [
  {
    id: 'openai/gpt-5-nano',
    name: 'GPT-5 Nano',
    owned_by: 'openai',
    type: 'language',
    tags: [],
  },
  {
    id: 'google/gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    owned_by: 'google',
    type: 'language',
    tags: ['vision'],
  },
];

function config(overrides: Partial<RagConfig>): RagConfig {
  return {
    projectName: 'provider-routing-test',
    embeddingProvider: 'vercel_ai_gateway',
    embeddingModelId: 'openai/text-embedding-3-small',
    indexType: 'hybrid',
    chunking: { chunkSize: 512, chunkOverlap: 64, strategy: 'recursive' },
    vectorStore: 'lancedb',
    storeConfig: {},
    topK: 5,
    updatedAt: new Date(0).toISOString(),
    ...overrides,
  };
}

test.describe('Media vision provider routing', () => {
  test('uses Vercel AI Gateway for vision while Deepgram remains the audio provider', () => {
    const resolved = resolveConfiguredChatModel(
      config({
        chatProvider: 'vercel_ai_gateway',
        chatModelId: 'google/gemini-2.5-flash',
        chatApiKey: 'vck_test_gateway_key',
        toolConfigs: {
          'video-audio': {
            audioProvider: 'deepgram',
            audioApiKey: 'deepgram_test_key',
          },
        },
      }),
      catalog,
    );

    expect(resolved).toEqual({
      provider: 'vercel_ai_gateway',
      modelId: 'google/gemini-2.5-flash',
      apiKey: 'vck_test_gateway_key',
    });

    const model = createChatModel(resolved.provider, resolved.modelId, resolved.apiKey);
    expect(model.provider).toBe('gateway');
    expect(model.modelId).toBe('google/gemini-2.5-flash');
  });

  test('selects a vision-capable gateway model dynamically when the model setting is Default', () => {
    const resolved = resolveConfiguredChatModel(
      config({
        chatProvider: 'vercel_ai_gateway',
        chatModelId: '',
        chatApiKey: 'vck_test_gateway_key',
      }),
      catalog,
      { requiredTag: 'vision' },
    );

    expect(resolved.provider).toBe('vercel_ai_gateway');
    expect(resolved.modelId).toBe('google/gemini-2.5-flash');
    expect(createChatModel(resolved.provider, resolved.modelId, resolved.apiKey).provider).toBe(
      'gateway',
    );
  });

  test('does not replace a configured native provider with the first vision model in the catalog', () => {
    const resolved = resolveConfiguredChatModel(
      config({
        chatProvider: 'google',
        chatModelId: 'google/gemini-2.5-flash',
        chatApiKey: 'google_test_key',
      }),
      catalog,
    );

    expect(resolved.provider).toBe('google');
    expect(resolved.modelId).toBe('google/gemini-3.6-flash');

    const model = createChatModel(resolved.provider, resolved.modelId, resolved.apiKey);
    expect(model.provider).toContain('google');
    expect(model.modelId).toBe('gemini-3.6-flash');
  });

  test('uses the dedicated vision provider and its default VLM independently from chat', () => {
    const resolved = resolveConfiguredVisionModel(
      config({
        chatProvider: 'anthropic',
        chatModelId: 'anthropic/text-only-model',
        chatApiKey: 'anthropic_test_key',
        visionProvider: 'google',
        visionModelId: '',
        visionApiKey: 'google_test_key',
      }),
      catalog,
    );

    expect(resolved).toEqual({
      provider: 'google',
      modelId: 'google/gemini-3.6-flash',
      apiKey: 'google_test_key',
    });
  });
});
