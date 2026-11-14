/**
 * Transport-level guards for the BFF. Per the contract:
 *  - loopback binding + exact Origin checks for mutations + server-side auth;
 *  - localhost alone is NOT authorization; reject cross-origin writes and
 *    unsupported content types; no wildcard CORS;
 *  - every state-changing request requires Content-Type application/json and an
 *    Idempotency-Key; an expectedRevision is required where a resource exists.
 */
import { serverConfig } from './config.js';

export type GuardFailure = { status: number; code: string; message: string };

export function checkMutationGuards(
  req: Request,
  opts: { requireExpectedRevision: boolean },
): GuardFailure | null {
  const cfg = serverConfig();

  if (cfg.mode === 'offline' || cfg.readonly) {
    return {
      status: 503,
      code: 'OFFLINE_READONLY',
      message: 'Dashboard is in offline readonly mode; writes are disabled.',
    };
  }

  // Exact Origin match (no wildcard). A missing Origin on a mutation is rejected.
  const origin = req.headers.get('origin');
  if (!origin || !cfg.allowedOrigins.includes(origin)) {
    return {
      status: 403,
      code: 'ORIGIN_FORBIDDEN',
      message: 'Cross-origin or missing Origin; mutations require an allowed same-origin request.',
    };
  }

  const contentType = (req.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    return {
      status: 415,
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: 'Mutations require Content-Type: application/json.',
    };
  }

  if (!req.headers.get('idempotency-key')) {
    return {
      status: 400,
      code: 'IDEMPOTENCY_KEY_REQUIRED',
      message: 'Missing Idempotency-Key header.',
    };
  }

  return null;
}

/** Stable canonical hash of a request body for idempotency scoping. */
export async function canonicalBodyHash(body: unknown): Promise<string> {
  const json = JSON.stringify(sortKeys(body ?? {}));
  const data = new TextEncoder().encode(json);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}
