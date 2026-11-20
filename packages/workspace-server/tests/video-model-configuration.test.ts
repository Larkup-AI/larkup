import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertVideoIntelligenceConfiguration,
  resolveVideoJobModelConfiguration,
} from '../src/lib/media/video-intelligence-adapter.ts';

test('the benchmark-selected hosted reader passes video admission with separate audio credentials', () => {
  const config = {
    videoVisionProvider: 'vercel_ai_gateway',
    videoVisionApiKey: 'vision-test',
    semanticVisionModel: 'alibaba/qwen3.8-max',
    videoAgentProvider: 'deepseek',
    videoAgentApiKey: 'brain-test',
    audioProvider: 'deepgram',
    audioApiKey: 'audio-test',
  };
  assert.doesNotThrow(() => assertVideoIntelligenceConfiguration(config));
  assert.equal(resolveVideoJobModelConfiguration(config).vision.model, 'alibaba/qwen3.8-max');
  assert.throws(
    () =>
      assertVideoIntelligenceConfiguration({ ...config, semanticVisionModel: 'text-only-model' }),
    /not supported/,
  );
});
