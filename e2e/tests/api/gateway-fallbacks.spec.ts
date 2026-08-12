import { expect, test } from '@playwright/test';
import {
  GATEWAY_FALLBACK_MODELS,
  gatewayProviderOptions,
} from '../../../apps/web/lib/gateway-fallbacks';
import { BUILTIN_TOOLS } from '../../../packages/hub-db/src/builtin-tools';

test('Vercel AI Gateway uses provider-diverse backups without retrying its primary model', () => {
  const primary = 'alibaba/qwen-3-14b';
  expect(gatewayProviderOptions('vercel_ai_gateway', primary)).toEqual({
    gateway: { models: GATEWAY_FALLBACK_MODELS },
  });
  expect(gatewayProviderOptions('openai', 'openai/gpt-4o-mini')).toBeUndefined();
  expect(gatewayProviderOptions('vercel_ai_gateway', 'openai/gpt-4o-mini')).toEqual({
    gateway: {
      models: GATEWAY_FALLBACK_MODELS.filter((model) => model !== 'openai/gpt-4o-mini'),
    },
  });
});

test('the Hub advertises bundled video processing without a system ffmpeg dependency', () => {
  const videoTool = BUILTIN_TOOLS.find((tool) => tool.id === 'video-audio');

  expect(videoTool).toMatchObject({
    version: '0.3.6',
    packageName: '@larkup/tool-video-audio',
  });
  expect(videoTool?.systemDeps).toBeUndefined();
  expect(videoTool?.longDescription).toContain('Includes ffmpeg automatically');
});
