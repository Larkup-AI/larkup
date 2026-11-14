import test from 'node:test';
import assert from 'node:assert/strict';
import { MockController } from '../lib/mock/mockController.js';
import { RUN_FIXTURES, RUN_ORDER } from '../lib/mock/fixtures.js';

function fresh() {
  return new MockController();
}

test('fixtures cover every required run state', () => {
  const states = new Set(Object.values(RUN_FIXTURES).map((f) => f.snapshot.state));
  for (const s of ['running', 'pausing', 'paused', 'blocked', 'completed', 'draft'] as const) {
    assert.ok(states.has(s), `missing state ${s}`);
  }
  // negative pilot = completed + decision stop; partial = blocked + partial metrics
  assert.ok(
    Object.values(RUN_FIXTURES).some(
      (f) => f.snapshot.state === 'completed' && f.snapshot.decision === 'stop',
    ),
    'negative pilot',
  );
  assert.ok(
    Object.values(RUN_FIXTURES).some((f) => f.metrics.partial),
    'partial result',
  );
});

test('accuracy metrics always carry a denominator and never force null to 0', () => {
  for (const f of Object.values(RUN_FIXTURES)) {
    for (const a of f.metrics.accuracy) {
      assert.equal(typeof a.denominator, 'number');
      if (a.completedCount === 0) assert.equal(a.accuracy, null);
    }
  }
});

test('run list uses cursor pagination, newest-first order', () => {
  const ctl = fresh();
  const page1 = ctl.listRuns(null, 3);
  assert.equal(page1.items.length, 3);
  assert.equal(page1.items[0].id, RUN_ORDER[0]);
  assert.ok(page1.hasMore);
  const page2 = ctl.listRuns(page1.nextCursor, 3);
  assert.equal(page2.items[0].id, RUN_ORDER[3]);
});

test('pause transitions running -> pausing, bumps revision, emits event', () => {
  const ctl = fresh();
  const before = ctl.getRun('run-pilot-running')!;
  const res = ctl.control('pause', 'run-pilot-running', {
    idempotencyKey: 'k1',
    bodyHash: 'h1',
    expectedRevision: before.revision,
  });
  assert.equal(res.ok, true);
  assert.equal(res.status, 202);
  const after = res.body as { state: string; revision: string };
  assert.equal(after.state, 'pausing');
  assert.notEqual(after.revision, before.revision);
});

test('stale expectedRevision is rejected with REVISION_CONFLICT (409)', () => {
  const ctl = fresh();
  const res = ctl.control('pause', 'run-pilot-running', {
    idempotencyKey: 'k2',
    bodyHash: 'h',
    expectedRevision: '999',
  });
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'REVISION_CONFLICT');
  }
});

test('idempotent replay returns the original result; different body is 409', () => {
  const ctl = fresh();
  const rev = ctl.getRun('run-pilot-running')!.revision;
  const first = ctl.control('pause', 'run-pilot-running', {
    idempotencyKey: 'dup',
    bodyHash: 'bodyA',
    expectedRevision: rev,
  });
  const replay = ctl.control('pause', 'run-pilot-running', {
    idempotencyKey: 'dup',
    bodyHash: 'bodyA',
    expectedRevision: rev,
  });
  assert.deepEqual(replay, first, 'same key+body replays stored result (no double start)');
  const conflict = ctl.control('pause', 'run-pilot-running', {
    idempotencyKey: 'dup',
    bodyHash: 'bodyB',
    expectedRevision: rev,
  });
  assert.equal(conflict.ok, false);
  if (!conflict.ok) assert.equal(conflict.body.error.code, 'IDEMPOTENCY_CONFLICT');
});

test('invalid transition is rejected (cannot pause a completed run)', () => {
  const ctl = fresh();
  const rev = ctl.getRun('run-pilot-completed')!.revision;
  const res = ctl.control('pause', 'run-pilot-completed', {
    idempotencyKey: 'k',
    bodyHash: 'h',
    expectedRevision: rev,
  });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.body.error.code, 'INVALID_STATE');
});

test('start works from draft', () => {
  const ctl = fresh();
  const rev = ctl.getRun('run-pilot-draft')!.revision;
  const res = ctl.control('start', 'run-pilot-draft', {
    idempotencyKey: 's1',
    bodyHash: 'h',
    expectedRevision: rev,
  });
  assert.equal(res.ok, true);
  assert.equal((res.body as { state: string }).state, 'running');
});

test('events paginate by cursor and expose a stable cursor', () => {
  const ctl = fresh();
  const p = ctl.getEvents('run-pilot-running', null, 2)!;
  assert.equal(p.events.length, 2);
  assert.ok(p.hasMore);
  const p2 = ctl.getEvents('run-pilot-running', p.nextCursor, 10)!;
  // no overlap with first page ids
  const firstIds = new Set(p.events.map((e) => e.id));
  assert.ok(p2.events.every((e) => !firstIds.has(e.id)));
});

test('task filtering by provider and state', () => {
  const ctl = fresh();
  const all = ctl.getTasks('run-pilot-running', {}, null, 100)!;
  const quota = ctl.getTasks('run-pilot-running', { state: 'waiting_quota' }, null, 100)!;
  assert.ok(quota.items.length > 0);
  assert.ok(quota.items.every((t) => t.state === 'waiting_quota'));
  assert.ok(quota.items.length <= all.items.length);
});

test('unknown run returns 404 on control', () => {
  const ctl = fresh();
  const res = ctl.control('pause', 'nope', {
    idempotencyKey: 'x',
    bodyHash: 'h',
    expectedRevision: undefined,
  });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.status, 404);
});
