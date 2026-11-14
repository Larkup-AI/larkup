/**
 * BFF for the Video benchmark controller API v1.
 *
 * The browser talks ONLY to this same-origin endpoint. In `proxy` mode this
 * forwards approved operations to the real controller with the server-side
 * bearer token; in `mock` mode it serves in-memory contract fixtures; in
 * `offline` mode it serves a readonly last-synced snapshot and refuses writes.
 *
 * It enforces the contract's transport rules for mutations (exact Origin,
 * Content-Type, Idempotency-Key, expectedRevision) and never leaks the
 * controller URL/token or any raw provider/secret header to the client.
 */
import { NextResponse } from 'next/server.js';
import { serverConfig, publicConfig } from '../../../../lib/server/config.js';
import { checkMutationGuards, canonicalBodyHash } from '../../../../lib/server/auth.js';
import { proxyToController } from '../../../../lib/server/controllerClient.js';
import { resultsToCsv, csvChecksum } from '../../../../lib/server/csv.js';
import { mockController } from '../../../../lib/mock/mockController.js';
import { OFFLINE_LAST_SYNCED_AT } from '../../../../lib/mock/fixtures.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CONTROL_OPS = new Set(['start', 'pause', 'resume', 'cancel']);

type Ctx = { params: { path?: string[] } };

function errResponse(
  status: number,
  code: string,
  message: string,
  retryable = false,
  nextEligibleAt: string | null = null,
) {
  return NextResponse.json(
    { error: { code, message, retryable, nextEligibleAt, requestId: `bff-${Date.now()}` } },
    { status },
  );
}

// ---------------------------------------------------------------------------
// GET — reads
// ---------------------------------------------------------------------------
export async function GET(req: Request, { params }: Ctx) {
  const segments = params.path ?? [];
  const cfg = serverConfig();
  const url = new URL(req.url);
  const sp = url.searchParams;

  if (segments.length === 1 && segments[0] === '_meta') {
    const meta = publicConfig();
    if (cfg.mode === 'proxy') {
      try {
        const response = await proxyToController({ method: 'GET', path: 'health', search: '' });
        const health = JSON.parse(response.body);
        return NextResponse.json({
          ...meta,
          writesEnabled: meta.writesEnabled && health.availability === 'available',
          operatorEnabled: !cfg.readonly,
          availability: health.availability,
          lastSyncedAt: health.lastSyncedAt ?? null,
        });
      } catch {
        return NextResponse.json({
          ...meta,
          writesEnabled: false,
          operatorEnabled: !cfg.readonly,
          availability: 'offline',
        });
      }
    }
    return NextResponse.json({ ...meta, operatorEnabled: false });
  }

  if (cfg.mode === 'proxy') {
    const res = await proxyToController({
      method: 'GET',
      path: segments.join('/'),
      search: url.search,
    });
    return rawResponse(res);
  }

  // mock + offline reads share the in-memory controller.
  const ctl = mockController();

  if (segments.length === 1 && segments[0] === 'health') {
    const h = ctl.health();
    if (cfg.mode === 'offline')
      return NextResponse.json({
        ...h,
        availability: 'offline',
        mode: 'offline',
        lastSyncedAt: OFFLINE_LAST_SYNCED_AT,
      });
    return NextResponse.json(h);
  }

  if (segments.length === 1 && segments[0] === 'provider-scopes') {
    return NextResponse.json({ items: ctl.providerScopes(), nextCursor: null, hasMore: false });
  }

  if (segments.length === 1 && segments[0] === 'config') {
    return NextResponse.json({
      profiles: ctl.config(),
      activeRevision: ctl.config().find((p) => p.active)?.revision ?? null,
    });
  }

  if (segments[0] === 'runs') {
    // GET /runs
    if (segments.length === 1) {
      const limit = clampLimit(sp.get('limit'));
      return NextResponse.json(ctl.listRuns(sp.get('cursor'), limit));
    }
    const id = segments[1];

    // GET /runs/{id}
    if (segments.length === 2) {
      const snap = ctl.getRun(id);
      return snap ? NextResponse.json(snap) : errResponse(404, 'NOT_FOUND', `Unknown run ${id}.`);
    }

    const sub = segments[2];

    if (sub === 'tasks' && segments.length === 3) {
      const page = ctl.getTasks(
        id,
        {
          state: sp.get('state') || undefined,
          provider: sp.get('provider') || undefined,
          sourceId: sp.get('sourceId') || undefined,
        },
        sp.get('cursor'),
        clampLimit(sp.get('limit')),
      );
      return page ? NextResponse.json(page) : errResponse(404, 'NOT_FOUND', `Unknown run ${id}.`);
    }

    if (sub === 'results' && segments.length === 3) {
      const page = ctl.getResults(
        id,
        {
          variantId: sp.get('variantId') || undefined,
          durationGroup: sp.get('durationGroup') || undefined,
        },
        sp.get('cursor'),
        clampLimit(sp.get('limit')),
      );
      return page ? NextResponse.json(page) : errResponse(404, 'NOT_FOUND', `Unknown run ${id}.`);
    }

    if (sub === 'metrics' && segments.length === 3) {
      const m = ctl.getMetrics(id);
      return m ? NextResponse.json(m) : errResponse(404, 'NOT_FOUND', `Unknown run ${id}.`);
    }

    if (sub === 'events' && segments.length === 3) {
      const page = ctl.getEvents(id, sp.get('after'), clampLimit(sp.get('limit')));
      return page ? NextResponse.json(page) : errResponse(404, 'NOT_FOUND', `Unknown run ${id}.`);
    }

    if (sub === 'exports' && segments[3] === 'results.csv' && segments.length === 4) {
      const results = ctl.getAllResults(id);
      if (!results) return errResponse(404, 'NOT_FOUND', `Unknown run ${id}.`);
      const csv = resultsToCsv(results);
      const etag = await csvChecksum(csv);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="${id}-results.csv"`,
          etag: `"${etag}"`,
          'cache-control': 'no-store',
        },
      });
    }
  }

  return errResponse(404, 'NOT_FOUND', `No such endpoint: /${segments.join('/')}`);
}

// ---------------------------------------------------------------------------
// POST — mutations (controls, create)
// ---------------------------------------------------------------------------
export async function POST(req: Request, { params }: Ctx) {
  const segments = params.path ?? [];
  const cfg = serverConfig();
  const url = new URL(req.url);

  const isControl = segments[0] === 'runs' && segments.length === 3 && CONTROL_OPS.has(segments[2]);
  const isCreate = segments[0] === 'runs' && segments.length === 1;
  const isSystem =
    segments[0] === 'system' &&
    segments.length === 2 &&
    new Set(['start', 'pause', 'resume', 'stop-gpu', 'force-stop-gpu']).has(segments[1]);

  if (!isControl && !isCreate && !isSystem) {
    return errResponse(404, 'NOT_FOUND', `No such mutation: /${segments.join('/')}`);
  }

  if (isSystem && cfg.mode !== 'proxy')
    return errResponse(
      409,
      'LIVE_OPERATOR_REQUIRED',
      'GPU controls require the real local operator bridge.',
    );

  // Transport guards (Origin, Content-Type, Idempotency-Key, offline readonly).
  const guard = checkMutationGuards(req, { requireExpectedRevision: isControl || isSystem });
  if (guard)
    return errResponse(guard.status, guard.code, guard.message, guard.code === 'OFFLINE_READONLY');

  const idempotencyKey = req.headers.get('idempotency-key')!;

  let body: Record<string, unknown> = {};
  try {
    const text = await req.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return errResponse(400, 'INVALID_JSON', 'Request body is not valid JSON.');
  }

  if (cfg.mode === 'proxy') {
    const res = await proxyToController({
      method: 'POST',
      path: segments.join('/'),
      search: url.search,
      body: JSON.stringify(body),
      idempotencyKey,
      expectedRevision:
        typeof body.expectedRevision === 'string'
          ? body.expectedRevision
          : req.headers.get('if-match') || null,
    });
    return rawResponse(res);
  }

  // mock mode
  const ctl = mockController();

  if (isCreate) {
    // Minimal draft creation: contract requires a validated manifest/variants/phase.
    const bodyHash = await canonicalBodyHash(body);
    // (Mock) echo a draft summary; real controller owns DAG construction.
    void bodyHash;
    return errResponse(
      501,
      'NOT_IMPLEMENTED_IN_MOCK',
      'Run creation is owned by the benchmark controller; the mock exposes preset runs including a draft (run-pilot-draft) to exercise Start.',
    );
  }

  const op = segments[2] as 'start' | 'pause' | 'resume' | 'cancel';
  const id = segments[1];
  const expectedRevision =
    typeof body.expectedRevision === 'string' ? body.expectedRevision : undefined;
  const bodyHash = await canonicalBodyHash(body);
  const result = ctl.control(op, id, { idempotencyKey, bodyHash, expectedRevision });
  return NextResponse.json(result.body, { status: result.status });
}

// ---------------------------------------------------------------------------
function clampLimit(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 50;
  return Math.min(200, Math.floor(n));
}

function rawResponse(res: {
  status: number;
  contentType: string;
  body: string;
  headers: Record<string, string>;
}) {
  return new NextResponse(res.body, {
    status: res.status,
    headers: { 'content-type': res.contentType, ...res.headers },
  });
}
