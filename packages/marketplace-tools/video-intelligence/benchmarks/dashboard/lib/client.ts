/**
 * Browser-side client. Talks ONLY to this app's same-origin /api/v1 BFF.
 * It never sees the controller URL or token. Control (mutating) requests carry
 * an Idempotency-Key header and an expectedRevision body field, and surface
 * 409 revision/idempotency conflicts to the caller for a refresh.
 */
import type {
  ConfigProfile,
  Cursored,
  EventPage,
  Health,
  ResultObject,
  RunMetrics,
  RunSnapshot,
  RunSummary,
  ProviderScope,
  TaskObject,
} from './contract.js';
import { newIdempotencyKey } from './format.js';

const BASE = '/api/v1';

export type PublicMeta = {
  mode: 'mock' | 'proxy' | 'offline';
  writesEnabled: boolean;
  controllerConfigured: boolean;
  operatorEnabled?: boolean;
  availability?: string;
  lastSyncedAt?: string | null;
};

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) throw await toError(res);
  return res.json() as Promise<T>;
}

async function toError(res: Response): Promise<Error & { status: number; code?: string }> {
  let code: string | undefined;
  let message = res.statusText;
  try {
    const body = await res.json();
    code = body?.error?.code;
    message = body?.error?.message ?? message;
  } catch {
    /* non-JSON */
  }
  const e = new Error(message) as Error & { status: number; code?: string };
  e.status = res.status;
  e.code = code;
  return e;
}

export const api = {
  meta: () => getJson<PublicMeta>('/_meta'),
  health: () => getJson<Health>('/health'),
  runs: (cursor?: string | null) =>
    getJson<Cursored<RunSummary>>(`/runs${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
  run: (id: string) => getJson<RunSnapshot>(`/runs/${encodeURIComponent(id)}`),
  tasks: (id: string, q: Record<string, string> = {}) =>
    getJson<Cursored<TaskObject>>(
      `/runs/${encodeURIComponent(id)}/tasks${qs({ limit: '200', ...q })}`,
    ),
  results: (id: string, q: Record<string, string> = {}) =>
    getJson<Cursored<ResultObject>>(
      `/runs/${encodeURIComponent(id)}/results${qs({ limit: '200', ...q })}`,
    ),
  metrics: (id: string) => getJson<RunMetrics>(`/runs/${encodeURIComponent(id)}/metrics`),
  events: (id: string, after?: string | null) =>
    getJson<EventPage>(
      `/runs/${encodeURIComponent(id)}/events?limit=200${after ? `&after=${encodeURIComponent(after)}` : ''}`,
    ),
  providerScopes: () => getJson<Cursored<ProviderScope>>('/provider-scopes'),
  config: () => getJson<{ profiles: ConfigProfile[]; activeRevision: string | null }>('/config'),
  csvUrl: (id: string) => `${BASE}/runs/${encodeURIComponent(id)}/exports/results.csv`,

  /** Control a run. Returns the accepted snapshot, or throws with .status/.code. */
  async control(
    op: 'start' | 'pause' | 'resume' | 'cancel',
    id: string,
    expectedRevision: string,
  ): Promise<RunSnapshot> {
    const res = await fetch(`${BASE}/runs/${encodeURIComponent(id)}/${op}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': newIdempotencyKey(op, id, expectedRevision),
      },
      body: JSON.stringify({ expectedRevision }),
    });
    if (!res.ok) throw await toError(res);
    return res.json() as Promise<RunSnapshot>;
  },
};

function qs(q: Record<string, string>): string {
  const entries = Object.entries(q).filter(([, v]) => v);
  if (!entries.length) return '';
  return '?' + entries.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}
