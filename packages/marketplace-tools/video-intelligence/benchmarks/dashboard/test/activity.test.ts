import test from 'node:test';
import assert from 'node:assert/strict';
import { providerActivity, retryCountdown } from '../lib/activity.js';
import type { TaskObject } from '../lib/contract.js';

const row = {
  variantId: 'current-model',
  plannedCount: 10,
  completedCount: 2,
  blockedCount: 0,
  stateCounts: { pending: 8, completed: 2 },
};
const base = { row, runState: 'running' as const, live: true, tasks: [] as TaskObject[] };

test('GPU wait is orange without claiming provider execution', () => {
  assert.deepEqual(providerActivity({ ...base, row: undefined, queueLabel: 'Waiting for GPU' }), {
    label: 'Waiting for GPU',
    tone: 'warn',
    pulse: false,
  });
});

test('active summary includes tasks outside the first task page', () => {
  assert.deepEqual(providerActivity({ ...base, row: { ...row, stateCounts: { submitted: 1 } } }), {
    label: 'Processing',
    tone: 'go',
    pulse: true,
  });
});

test('source preparation pulses only for its immutable variant', () => {
  const task = { variantId: row.variantId, state: 'leased', questionId: null } as TaskObject;
  assert.equal(providerActivity({ ...base, tasks: [task] }).pulse, true);
  assert.equal(
    providerActivity({ ...base, tasks: [{ ...task, variantId: 'historic-model' }] }).pulse,
    false,
  );
});

test('queued and quota waits are orange and do not pulse', () => {
  assert.deepEqual(providerActivity(base), {
    label: 'Preparing / queued',
    tone: 'warn',
    pulse: false,
  });
  assert.deepEqual(
    providerActivity({ ...base, row: { ...row, stateCounts: { waiting_quota: 1 } } }),
    { label: 'Waiting for quota', tone: 'warn', pulse: false },
  );
});

test('active work remains visible when another task is blocked', () => {
  assert.equal(
    providerActivity({ ...base, row: { ...row, blockedCount: 1, stateCounts: { running: 1 } } })
      .pulse,
    true,
  );
});

test('paused and disconnected snapshots never show live activity', () => {
  const active = { ...base, row: { ...row, stateCounts: { running: 1 } } };
  assert.deepEqual(providerActivity({ ...active, live: false }), {
    label: 'Saved checkpoint',
    tone: 'idle',
    pulse: false,
  });
  assert.deepEqual(providerActivity({ ...active, runState: 'paused' }), {
    label: 'paused',
    tone: 'idle',
    pulse: false,
  });
});

test('completed and absent providers have stable non-pulsing dots', () => {
  assert.deepEqual(providerActivity({ ...base, row: { ...row, completedCount: 10 } }), {
    label: 'Complete',
    tone: 'go',
    pulse: false,
  });
  assert.deepEqual(providerActivity({ ...base, row: undefined }), {
    label: 'Not in this run',
    tone: 'idle',
    pulse: false,
  });
  assert.notEqual(
    providerActivity({ ...base, row: { ...row, plannedCount: 0, completedCount: 0 } }).label,
    'Complete',
  );
});

test('retry countdown handles scheduled, due and missing timestamps', () => {
  const now = Date.parse('2026-01-01T12:00:00Z');
  assert.equal(retryCountdown('2026-01-01T12:02:05Z', now), 'in 2m 5s');
  assert.equal(retryCountdown('2026-01-01T12:00:01Z', now), 'in 1s');
  assert.equal(retryCountdown('2026-01-01T11:59:59Z', now), 'checking capacity…');
  assert.equal(retryCountdown(null, now), null);
  assert.equal(retryCountdown('invalid', now), null);
});

test('blocked service checks remain actionable after the controller disconnects', () => {
  const blocked = { ...row, blockedCount: 4, stateCounts: { blocked: 4 } };
  for (const live of [true, false]) {
    assert.deepEqual(providerActivity({ ...base, row: blocked, runState: 'blocked', live }), {
      label: '4 blocked',
      tone: 'bad',
      pulse: false,
    });
  }
});

test('completed provider results keep their meaning in saved checkpoints', () => {
  assert.deepEqual(
    providerActivity({ ...base, live: false, row: { ...row, completedCount: 10 } }),
    { label: 'Complete', tone: 'go', pulse: false },
  );
});
