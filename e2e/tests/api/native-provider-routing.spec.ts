import { expect, test } from '@playwright/test';
import {
  DEFAULT_NATIVE_CHAT_MODELS,
  getChatModelsForProvider,
  getDefaultChatModel,
  getDefaultVisionModel,
  isNativeChatModel,
  normalizeNativeChatModelId,
} from '../../../packages/core/src/chat-models/registry';

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
});
