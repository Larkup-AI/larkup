import assert from 'node:assert/strict';
import test from 'node:test';
import { loadGatewayModels, refreshModelsCache } from './models-cache';
import { ALL_MODELS } from './models-list';
import { estimateCost } from './analytics-store';

test('the current catalog replaces retired static model IDs', async () => {
  const models = [{ id: 'vendor/current', name: 'Current', owned_by: 'vendor', type: 'language' }];
  const result = await loadGatewayModels(
    async () => new Response(JSON.stringify({ data: models })),
  );
  assert.deepEqual(result, models);
});
test('invalid or unavailable catalog responses cannot replace cached metadata', async () => {
  for (const body of [{ data: [] }, { data: [{ id: 'incomplete' }] }, {}]) {
    await assert.rejects(loadGatewayModels(async () => new Response(JSON.stringify(body))));
  }
  await assert.rejects(loadGatewayModels(async () => new Response('', { status: 503 })));
});

test('newly available models use live catalog prices for usage estimation', async () => {
  const originalFetch = globalThis.fetch;
  const current = {
    id: 'vendor/new-model',
    name: 'New model',
    owned_by: 'vendor',
    type: 'language',
    pricing: { input: '0.000001', output: '0.000002' },
  };
  globalThis.fetch = async () => new Response(JSON.stringify({ data: [current] }));
  try {
    await refreshModelsCache();
    assert.ok(Math.abs(estimateCost(current.id, 1000, 200) - 0.0014) < 1e-12);
  } finally {
    globalThis.fetch = async () => new Response(JSON.stringify({ data: ALL_MODELS }));
    await refreshModelsCache();
    globalThis.fetch = originalFetch;
  }
});
