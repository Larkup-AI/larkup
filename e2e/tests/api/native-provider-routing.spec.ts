import { expect, test } from '@playwright/test';
import {
  DEFAULT_NATIVE_CHAT_MODELS,
  getChatModelsForProvider,
  getDefaultChatModel,
  getDefaultVisionModel,
  getVisionModelsForProvider,
  isNativeChatModel,
  normalizeNativeChatModelId,
  toChatDescriptor,
} from '../../../packages/core/src/chat-models/registry';
import { ALL_MODELS } from '../../../packages/core/src/models-list';

test.describe('native provider model routing', () => {
  test('exposes only current, tool-capable Gemini models to direct Google API users', () => {
    const models = getChatModelsForProvider([], 'google');

    expect(models.map((model) => model.id)).toEqual([
      'google/gemini-3.6-flash',
      'google/gemini-3.5-flash',
      'google/gemini-3.5-flash-lite',
      'google/gemini-3.1-pro-preview',
      'google/gemini-3.1-flash-lite',
      'google/gemini-3-flash-preview',
    ]);
    expect(models.every((model) => model.tags?.includes('tool-use'))).toBe(true);
    expect(models.every((model) => model.tags?.includes('vision'))).toBe(true);
    expect(models.some((model) => model.id === 'google/gemini-2.5-flash')).toBe(false);
    expect(models.some((model) => model.id === 'google/gemini-3-flash')).toBe(false);
  });

  test('migrates unavailable saved Gemini model IDs without altering gateway selections', () => {
    expect(normalizeNativeChatModelId('google', 'google/gemini-2.5-flash')).toBe(
      'google/gemini-3.6-flash',
    );
    expect(normalizeNativeChatModelId('google', 'google/gemini-3-flash')).toBe(
      'google/gemini-3.6-flash',
    );
    expect(normalizeNativeChatModelId('vercel_ai_gateway', 'google/gemini-2.5-flash')).toBe(
      'google/gemini-2.5-flash',
    );
    expect(isNativeChatModel('google', 'google/gemini-3-flash-preview')).toBe(true);
  });

  test('keeps selected providers independent from gateway model IDs', () => {
    const catalog = [
      {
        id: 'openai/gpt-4o-mini',
        name: 'GPT-4o mini',
        provider: 'openai',
        tags: ['vision', 'tool-use'],
      },
    ];

    expect(getDefaultChatModel(catalog, 'google')?.id).toBe(DEFAULT_NATIVE_CHAT_MODELS.google);
    expect(getDefaultVisionModel(catalog, 'google')?.id).toBe(DEFAULT_NATIVE_CHAT_MODELS.google);
    expect(getChatModelsForProvider(catalog, 'openai')).toEqual(catalog);
  });

  test('does not offer Google-native Gemini models through Vercel AI Gateway', () => {
    const catalog = ALL_MODELS.filter((model) => model.type === 'language').map(toChatDescriptor);
    const gatewayModels = getVisionModelsForProvider(catalog, 'vercel_ai_gateway');
    const nativeGoogleModels = getVisionModelsForProvider(catalog, 'google');

    expect(gatewayModels.some((model) => model.id === 'google/gemini-2.5-flash')).toBe(true);
    expect(gatewayModels.some((model) => model.id === 'google/gemini-3.6-flash')).toBe(false);
    expect(nativeGoogleModels.some((model) => model.id === 'google/gemini-3.6-flash')).toBe(true);
  });
});
