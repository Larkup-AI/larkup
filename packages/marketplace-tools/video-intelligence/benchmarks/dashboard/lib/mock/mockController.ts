/**
 * In-memory mock controller implementing the v1 contract semantics the UI
 * depends on: cursor pagination, revision checks, idempotent controls, and
 * real pause/resume/cancel state transitions (with simulated draining).
 *
 * This is a UI fixture backend ONLY. It does not implement scheduling,
 * evaluation, routing or billing logic — those belong to the benchmark agent's
 * real controller. The dashboard surfaces backend fields; it never computes them.
 */
import {
  type ControllerEvent,
  type Cursored,
  type EventPage,
  type Health,
  type RunMetrics,
  type RunSnapshot,
  type RunState,
  type RunSummary,
  type ProviderScope,
  type ConfigProfile,
  type ResultObject,
  type TaskObject,
  isTerminal,
} from '../contract.js';
import {
  RUN_FIXTURES,
  RUN_ORDER,
  PROVIDER_SCOPES,
  CONFIG_PROFILES,
  OFFLINE_SNAPSHOT_RUN_ID,
} from './fixtures.js';

export type ControllerResult =
  | { ok: true; status: number; body: unknown }
  | {
      ok: false;
      status: number;
      body: {
        error: {
          code: string;
          message: string;
          retryable: boolean;
          nextEligibleAt: string | null;
          requestId: string;
        };
      };
    };

type Store = {
  snapshots: Record<string, RunSnapshot>;
  tasks: Record<string, TaskObject[]>;
  results: Record<string, ResultObject[]>;
  metrics: Record<string, RunMetrics>;
  events: Record<string, ControllerEvent[]>;
};

type IdempotencyRecord = { bodyHash: string; result: ControllerResult };

const CONTROL_TRANSITIONS: Record<string, { from: RunState[]; to: RunState; settleTo?: RunState }> =
  {
    start: { from: ['draft'], to: 'running' },
    pause: { from: ['running'], to: 'pausing', settleTo: 'paused' },
    resume: { from: ['paused', 'pausing'], to: 'running' },
    cancel: {
      from: ['draft', 'running', 'pausing', 'paused', 'blocked'],
      to: 'cancelling',
      settleTo: 'cancelled',
    },
  };

export class MockController {
  private store: Store;
  private idempotency = new Map<string, IdempotencyRecord>();
  private eventSeq = 1000;

  constructor() {
    this.store = {
      snapshots: {},
      tasks: {},
      results: {},
      metrics: {},
      events: {},
    };
    for (const id of Object.keys(RUN_FIXTURES)) {
      const f = RUN_FIXTURES[id];
      this.store.snapshots[id] = structuredClone(f.snapshot);
      this.store.tasks[id] = structuredClone(f.tasks);
      this.store.results[id] = structuredClone(f.results);
      this.store.metrics[id] = structuredClone(f.metrics);
      this.store.events[id] = structuredClone(f.events);
    }
  }

  // --- reads ---------------------------------------------------------------
  health(): Health {
    return {
      apiVersion: 'v1',
      controllerBuild: 'mock-0.1.0',
      schemaVersion: 'dashboard-api-v1',
      availability: 'available',
      serverTime: new Date().toISOString(),
      mode: 'mock',
    };
  }

  listRuns(cursor: string | null, limit: number): Cursored<RunSummary> {
    const ids = RUN_ORDER.filter((id) => this.store.snapshots[id]);
    const start = cursor ? Math.max(0, ids.indexOf(cursor) + 1) : 0;
    const slice = ids.slice(start, start + limit);
    const items: RunSummary[] = slice.map((id) => {
      const s = this.store.snapshots[id];
      return {
        id,
        phase: s.phase,
        state: s.state,
        decision: s.decision,
        updatedAt: s.updatedAt,
        datasetManifestId: s.datasetManifestId,
        label: labelFor(s),
      };
    });
    const last = slice[slice.length - 1];
    const hasMore = start + limit < ids.length;
    return { items, nextCursor: hasMore ? last : null, hasMore };
  }

  getRun(id: string): RunSnapshot | null {
    return this.store.snapshots[id] ? structuredClone(this.settle(id)) : null;
  }

  getTasks(
    id: string,
    filters: { state?: string; provider?: string; sourceId?: string },
    cursor: string | null,
    limit: number,
  ): Cursored<TaskObject> | null {
    if (!this.store.snapshots[id]) return null;
    let tasks = this.store.tasks[id] ?? [];
    if (filters.state) tasks = tasks.filter((t) => t.state === filters.state);
    if (filters.provider) tasks = tasks.filter((t) => t.provider === filters.provider);
    if (filters.sourceId) tasks = tasks.filter((t) => t.sourceId === filters.sourceId);
    return paginate(tasks, (t) => t.taskId, cursor, limit);
  }

  getResults(
    id: string,
    filters: { variantId?: string; durationGroup?: string },
    cursor: string | null,
    limit: number,
  ): Cursored<ResultObject> | null {
    if (!this.store.snapshots[id]) return null;
    let results = this.store.results[id] ?? [];
    if (filters.variantId) results = results.filter((r) => r.variantId === filters.variantId);
    if (filters.durationGroup)
      results = results.filter((r) => r.durationGroup === filters.durationGroup);
    return paginate(
      results,
      (r) => r.attemptId ?? `${r.sourceId}:${r.questionId}:${r.variantId}`,
      cursor,
      limit,
    );
  }

  getMetrics(id: string): RunMetrics | null {
    return this.store.metrics[id] ? structuredClone(this.store.metrics[id]) : null;
  }

  getAllResults(id: string): ResultObject[] | null {
    return this.store.results[id] ? structuredClone(this.store.results[id]) : null;
  }

  getEvents(id: string, after: string | null, limit: number): EventPage | null {
    if (!this.store.snapshots[id]) return null;
    const all = this.store.events[id] ?? [];
    const startIdx = after ? all.findIndex((e) => e.id === after) + 1 : 0;
    // Expired cursor: `after` provided but not found and not empty history.
    if (after && startIdx === 0 && all.length > 0 && !all.some((e) => e.id === after)) {
      return { events: [], nextCursor: after, hasMore: false };
    }
    const slice = all.slice(startIdx, startIdx + limit);
    const nextCursor = slice.length ? slice[slice.length - 1].id : (after ?? '0');
    return { events: structuredClone(slice), nextCursor, hasMore: startIdx + limit < all.length };
  }

  providerScopes(): ProviderScope[] {
    return structuredClone(PROVIDER_SCOPES);
  }
  config(): ConfigProfile[] {
    return structuredClone(CONFIG_PROFILES);
  }
  offlineSnapshotRunId(): string {
    return OFFLINE_SNAPSHOT_RUN_ID;
  }

  // --- controls ------------------------------------------------------------
  control(
    op: 'start' | 'pause' | 'resume' | 'cancel',
    id: string,
    opts: { idempotencyKey: string; bodyHash: string; expectedRevision: string | undefined },
  ): ControllerResult {
    const idemKey = `${op}:${id}:${opts.idempotencyKey}`;
    const existing = this.idempotency.get(idemKey);
    if (existing) {
      if (existing.bodyHash === opts.bodyHash) return existing.result; // replay
      return err(
        409,
        'IDEMPOTENCY_CONFLICT',
        'Same idempotency key used with a different body.',
        false,
      );
    }

    const snap = this.store.snapshots[id];
    if (!snap) return err(404, 'NOT_FOUND', `Unknown run ${id}.`, false);

    this.settle(id);
    const current = this.store.snapshots[id];

    if (opts.expectedRevision !== undefined && opts.expectedRevision !== current.revision) {
      return err(409, 'REVISION_CONFLICT', 'Run state changed; refresh.', false);
    }

    const transition = CONTROL_TRANSITIONS[op];
    if (!transition.from.includes(current.state)) {
      return err(409, 'INVALID_STATE', `Cannot ${op} a run in state ${current.state}.`, false);
    }

    current.state = transition.to;
    current.revision = String(Number(current.revision) + 1);
    current.updatedAt = new Date().toISOString();
    this.appendEvent(id, 'run.updated', current.revision, { state: current.state, op });

    if (transition.settleTo) {
      // record a settle target with a timestamp; `settle()` applies it on next read
      this.settleTargets.set(id, { to: transition.settleTo, at: Date.now() + 1500 });
    }

    const result: ControllerResult = { ok: true, status: 202, body: structuredClone(current) };
    this.idempotency.set(idemKey, { bodyHash: opts.bodyHash, result });
    return result;
  }

  private settleTargets = new Map<string, { to: RunState; at: number }>();

  /** Apply any pending pausing->paused / cancelling->cancelled transition. */
  private settle(id: string): RunSnapshot {
    const target = this.settleTargets.get(id);
    const snap = this.store.snapshots[id];
    if (target && Date.now() >= target.at && !isTerminal(snap.state)) {
      snap.state = target.to;
      snap.revision = String(Number(snap.revision) + 1);
      snap.updatedAt = new Date().toISOString();
      this.appendEvent(id, 'run.updated', snap.revision, { state: snap.state, settled: true });
      this.settleTargets.delete(id);
    }
    return snap;
  }

  private appendEvent(
    runId: string,
    type: ControllerEvent['type'],
    revision: string,
    data: Record<string, unknown>,
  ) {
    const id = String(++this.eventSeq);
    (this.store.events[runId] ??= []).push({
      id,
      type,
      runId,
      occurredAt: new Date().toISOString(),
      revision,
      data,
    });
    const snap = this.store.snapshots[runId];
    if (snap) snap.eventCursor = id;
  }
}

function labelFor(s: RunSnapshot): string {
  const map: Record<RunState, string> = {
    draft: 'Draft',
    running: 'Running',
    pausing: 'Pausing (draining)',
    paused: 'Paused',
    blocked: 'Quota-blocked',
    cancelling: 'Cancelling',
    cancelled: 'Cancelled',
    completed: s.decision === 'stop' ? 'Completed — negative pilot' : 'Completed',
    failed: 'Failed',
  };
  return `${s.phase} · ${map[s.state]}`;
}

function paginate<T>(
  items: T[],
  keyOf: (t: T) => string,
  cursor: string | null,
  limit: number,
): Cursored<T> {
  const start = cursor ? items.findIndex((i) => keyOf(i) === cursor) + 1 : 0;
  const slice = items.slice(start, start + limit);
  const hasMore = start + limit < items.length;
  return {
    items: structuredClone(slice),
    nextCursor: hasMore && slice.length ? keyOf(slice[slice.length - 1]) : null,
    hasMore,
  };
}

function err(
  status: number,
  code: string,
  message: string,
  retryable: boolean,
  nextEligibleAt: string | null = null,
): ControllerResult {
  return {
    ok: false,
    status,
    body: { error: { code, message, retryable, nextEligibleAt, requestId: `mock-${Date.now()}` } },
  };
}

// Singleton across hot reloads in dev.
const g = globalThis as unknown as { __mockController?: MockController };
export function mockController(): MockController {
  if (!g.__mockController) g.__mockController = new MockController();
  return g.__mockController;
}
