import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cachedRewatchModel } from '../paid-rewatch-cache.mjs';

async function fixture(t, base, extra = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rewatch-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const options = { directory, name: 'test/model', actions: [], caseKey: 'source-question', ...extra };
  return { options, model: cachedRewatchModel(base, options) };
}
test('concurrent identical requests and a process restart reuse one completed submission', async t => {
  let calls = 0;
  const base = { doGenerate: async () => { calls++; return { content: ['grounded observation'] }; } };
  const { model, options } = await fixture(t, base);
  const [a, b] = await Promise.all([model.doGenerate({ prompt: 'x' }), model.doGenerate({ prompt: 'x' })]);
  assert.deepEqual(a, b);
  assert.deepEqual(await cachedRewatchModel(base, options).doGenerate({ prompt: 'x' }), a);
  assert.equal(calls, 1);
});
test('lost provider response blocks both exact retries and changed-model retries', async t => {
  let calls = 0;
  const base = { doGenerate: async () => { calls++; throw Error('connection lost'); } };
  const { model, options } = await fixture(t, base);
  await assert.rejects(model.doGenerate({ prompt: 'x' }), /connection lost/);
  await assert.rejects(cachedRewatchModel(base, options).doGenerate({ prompt: 'x' }), /REMOTE_OUTCOME_UNKNOWN/);
  await assert.rejects(cachedRewatchModel(base, { ...options, name: 'other/model' }).doGenerate({ prompt: 'y' }), /REMOTE_OUTCOME_UNKNOWN/);
  assert.equal(calls, 1);
});
test('call cap rejects a new request while allowing cached reads', async t => {
  const { model } = await fixture(t, { doGenerate: async () => ({ content: [] }) }, { limit: 1 });
  await model.doGenerate({ prompt: 'x' });
  await model.doGenerate({ prompt: 'x' });
  await assert.rejects(model.doGenerate({ prompt: 'y' }), /CALL_LIMIT/);
});
test('invalid limits cannot disable the spending cap', () => {
  for (const limit of [NaN, -1, 5, 0.5]) assert.throws(() => cachedRewatchModel({}, { limit }), /INVALID_LIMIT/);
});

test('concurrent distinct ranges cannot exceed the cap', async t => {
  let calls = 0;
  const { model } = await fixture(t, { doGenerate: async () => { calls++; return { content: [] }; } }, { limit: 1 });
  const results = await Promise.allSettled([model.doGenerate({ prompt: 'a' }), model.doGenerate({ prompt: 'b' })]);
  assert.equal(calls, 1);
  assert.equal(results.filter(r => r.status === 'rejected').length, 1);
});
