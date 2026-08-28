import assert from 'node:assert/strict';
import test from 'node:test';
import { decideInspection, LIMITS } from './inspection-policy';
import { chunkTimeRange } from './inspection-chunking';

const roomyBudget = {
  remainingDurationSecs: 180,
  remainingBytes: 1024 * 1024 * 1024,
  remainingSandboxSeconds: 600,
  remainingSpendUsd: 0.5,
  usedBundleRuns: 0,
};

function estimateFor(durationSecs: number) {
  return {
    durationSecs,
    bytes: 64 * 1024 * 1024,
    sandboxSeconds: 30,
    spendUsd: 0,
    lowerResolutionProbability: 0.65,
  };
}

test('decideInspection: a required, <=LIMITS.durationSecs estimate is always required, never deferred', () => {
  const decision = decideInspection({
    required: true,
    plausibleRange: true,
    estimate: estimateFor(LIMITS.durationSecs),
    budget: roomyBudget,
  });
  assert.equal(decision.decision, 'required');
});

test('decideInspection: a required estimate wider than LIMITS.durationSecs is deferred, not required', () => {
  // Documents the exact trap this fixes: queryVideoKnowledge's outcome-tail
  // window can be up to 180s, but a single request that wide always falls
  // back to background-refinement -- callers must chunk it instead of
  // requesting it in one call.
  const decision = decideInspection({
    required: true,
    plausibleRange: true,
    estimate: estimateFor(180),
    budget: roomyBudget,
  });
  assert.equal(decision.decision, 'background-refinement');
});

test('chunkTimeRange: splits a 180s outcome window into <=LIMITS.durationSecs pieces covering it exactly', () => {
  const chunks = chunkTimeRange(120, 300, LIMITS.durationSecs);
  assert.equal(chunks.length, Math.ceil(180 / LIMITS.durationSecs));
  for (const chunk of chunks) {
    assert.ok(chunk.endSecs - chunk.startSecs <= LIMITS.durationSecs);
  }
  assert.equal(chunks[0]!.startSecs, 120);
  assert.equal(chunks.at(-1)!.endSecs, 300);
  for (let i = 1; i < chunks.length; i++) {
    assert.equal(chunks[i]!.startSecs, chunks[i - 1]!.endSecs);
  }
  // Every chunk this loop produces must independently clear the same gate
  // the first test above locks in -- otherwise chunking wouldn't help.
  for (const chunk of chunks) {
    const decision = decideInspection({
      required: true,
      plausibleRange: true,
      estimate: estimateFor(chunk.endSecs - chunk.startSecs),
      budget: roomyBudget,
    });
    assert.equal(decision.decision, 'required');
  }
});

test('chunkTimeRange: empty or inverted ranges produce no chunks', () => {
  assert.deepEqual(chunkTimeRange(10, 10, 30), []);
  assert.deepEqual(chunkTimeRange(10, 5, 30), []);
});
