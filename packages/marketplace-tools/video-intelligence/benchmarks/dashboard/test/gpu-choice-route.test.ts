import test from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '../app/api/v1/[...path]/route.js';

test('GPU choice passes the real BFF route and preserves the selected offer', async (t) => {
  process.env.DASHBOARD_MODE = 'proxy';
  process.env.BENCHMARK_READ_ONLY = '0';
  process.env.BENCHMARK_CONTROLLER_URL = 'http://127.0.0.1:28891';
  process.env.BENCHMARK_CONTROLLER_TOKEN = 'test-operator-token';
  const submitted = { offerId: 'quote-test', selection: '1' };
  let forwarded = false;
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.equal(url, 'http://127.0.0.1:28891/api/v1/system/gpu-choice');
    assert.deepEqual(JSON.parse(options.body as string), submitted);
    assert.equal((options.headers as Record<string,string>).authorization, 'Bearer test-operator-token');
    forwarded = true;
    return Response.json({ id: 'quote-test', action: 'gpu-choice', state: 'completed' }, {status: 202});
  });
  const response = await POST(new Request('http://127.0.0.1:3100/api/v1/system/gpu-choice', {
    method: 'POST', headers: {origin:'http://127.0.0.1:3100','content-type':'application/json','idempotency-key':'test-choice'},
    body: JSON.stringify(submitted),
  }), {params:{path:['system','gpu-choice']}});
  assert.equal(response.status, 202);
  assert.equal(forwarded, true);
  assert.equal((await response.json()).state, 'completed');
});
