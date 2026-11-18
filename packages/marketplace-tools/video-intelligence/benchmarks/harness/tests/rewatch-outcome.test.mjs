import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rewatchOutcomeRequiresReconciliation } from '../quick-look-bridge.mjs';

test('a local empty window does not invent an unknown paid request or discard a separate completed reading', () => {
  assert.equal(rewatchOutcomeRequiresReconciliation([{ found: 'The requested symbol is visible.' }, { error: 'No frames could be read from this range.' }]), false);
  assert.equal(rewatchOutcomeRequiresReconciliation([{ error: 'ffmpeg failed (1): cannot decode input' }]), false);
  assert.equal(rewatchOutcomeRequiresReconciliation([{ error: 'BENCHMARK_REWATCH_CALL_LIMIT' }]), false);
});
test('uncertain provider failures remain blocked even beside a healthy reading', () => {
  for (const error of ['REMOTE_OUTCOME_UNKNOWN', 'The operation was aborted due to timeout', 'Provider connection reset']) {
    assert.equal(rewatchOutcomeRequiresReconciliation([{ found: 'A partial observation.' }, { error }]), true);
  }
});
