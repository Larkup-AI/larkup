import assert from 'node:assert/strict';
import test from 'node:test';
import { estimateCost } from '@larkup/core/analytics-store';
import { usageModelAttribution, isGatewayChatModelAvailable } from '../src/lib/chat/model-provider';

test('provider version IDs remain visible without losing catalog-based cost accounting', () => {
  const usage = usageModelAttribution('openai/gpt-4o-mini', 'gpt-4o-mini-2024-07-18');
  assert.equal(usage.modelId, 'gpt-4o-mini-2024-07-18');
  assert.ok(estimateCost(usage.pricingModelId, 1000, 200) > 0);
});

test('live availability rejects retired public IDs while preserving configured workspace models', () => {
  const catalog = [{ id: 'vendor/current' }];
  assert.equal(isGatewayChatModelAvailable('vendor/current', catalog), true);
  assert.equal(isGatewayChatModelAvailable('vendor/retired', catalog), false);
  assert.equal(isGatewayChatModelAvailable('custom/private-model', catalog), false);
  assert.equal(
    isGatewayChatModelAvailable('custom:private-model', catalog, [{ modelName: 'private-model' }]),
    true,
  );
  assert.equal(
    isGatewayChatModelAvailable('custom:missing', catalog, [{ modelName: 'private-model' }]),
    false,
  );
});
