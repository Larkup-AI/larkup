import assert from 'node:assert/strict';
import test from 'node:test';
import { estimateCost } from '@larkup/core/analytics-store';
import { usageModelAttribution } from '../src/lib/chat/model-provider';

test('provider version IDs remain visible without losing catalog-based cost accounting', () => {
  const usage = usageModelAttribution('openai/gpt-4o-mini', 'gpt-4o-mini-2024-07-18');
  assert.equal(usage.modelId, 'gpt-4o-mini-2024-07-18');
  assert.ok(estimateCost(usage.pricingModelId, 1000, 200) > 0);
});
