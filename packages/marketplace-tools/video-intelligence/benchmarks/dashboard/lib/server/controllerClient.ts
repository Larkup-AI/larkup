/**
 * Server-side proxy to the real benchmark controller (proxy mode).
 *
 * The browser NEVER sees BENCHMARK_CONTROLLER_URL or BENCHMARK_CONTROLLER_TOKEN.
 * This BFF attaches the bearer token here, server-side only, and forwards just
 * the approved /api/v1 operations. It is a thin, allow-listed pass-through: it
 * does not implement routing, scheduling, billing or evaluation.
 */
import { serverConfig } from './config.js';

export type ProxyResponse = {
  status: number;
  contentType: string;
  /** Raw body text (JSON or CSV). Already produced by the controller. */
  body: string;
  /** Selected sanitized headers to echo (e.g. CSV disposition/etag). */
  headers: Record<string, string>;
};

const FORWARD_RESPONSE_HEADERS = ['content-disposition', 'etag', 'cache-control'];

export async function proxyToController(args: {
  method: 'GET' | 'POST';
  path: string; // e.g. "runs/run-1/pause"
  search: string; // leading "?" included or ""
  body?: string; // raw JSON string for POST
  idempotencyKey?: string | null;
  expectedRevision?: string | null;
}): Promise<ProxyResponse> {
  const cfg = serverConfig();
  if (!cfg.controllerUrl) {
    return json(503, {
      error: errBody('CONTROLLER_UNCONFIGURED', 'No BENCHMARK_CONTROLLER_URL configured.'),
    });
  }

  const url = `${cfg.controllerUrl.replace(/\/$/, '')}/api/v1/${args.path}${args.search}`;
  const headers: Record<string, string> = { accept: 'application/json, text/csv' };
  if (cfg.controllerToken) headers['authorization'] = `Bearer ${cfg.controllerToken}`;
  if (args.method === 'POST') {
    headers['content-type'] = 'application/json';
    headers['origin'] = `http://127.0.0.1:${cfg.port}`;
    if (args.idempotencyKey) headers['idempotency-key'] = args.idempotencyKey;
    if (args.expectedRevision) headers['if-match'] = args.expectedRevision;
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: args.method,
      headers,
      body: args.method === 'POST' ? (args.body ?? '{}') : undefined,
      // Controller is on SSH-forwarded loopback; no redirects expected.
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    return json(503, {
      error: errBody(
        'CONTROLLER_UNAVAILABLE',
        'Controller unreachable over the configured loopback tunnel.',
      ),
    });
  }

  const ct = (upstream.headers.get('content-type') || 'application/json').split(';')[0].trim();
  const text = await upstream.text();
  const echo: Record<string, string> = {};
  for (const h of FORWARD_RESPONSE_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) echo[h] = v;
  }
  // Never echo auth/set-cookie or any secret-bearing header back to the browser.
  return { status: upstream.status, contentType: ct, body: text, headers: echo };
}

function json(status: number, obj: unknown): ProxyResponse {
  return { status, contentType: 'application/json', body: JSON.stringify(obj), headers: {} };
}
function errBody(code: string, message: string) {
  return {
    code,
    message,
    retryable: code === 'CONTROLLER_UNAVAILABLE',
    nextEligibleAt: null,
    requestId: `bff-${Date.now()}`,
  };
}
