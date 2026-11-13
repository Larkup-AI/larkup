import assert from 'node:assert/strict';
import test from 'node:test';
import { loadGatewayModels } from './models-cache';

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
