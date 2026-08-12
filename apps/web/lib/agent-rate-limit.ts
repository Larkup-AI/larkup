/**
 * Rate limiting for browser-facing Agent endpoints (plan §8.5).
 *
 * `agent-access.ts` answers *who* may call an agent (origin, auth mode).
 * This answers *how much*. Three limits, one shared `MemoryRateLimiter`
 * (plan §8.5's chosen seam — see `@larkup/agent-contracts/rate-limit`),
 * namespaced by prefix so a visitor's request-rate bucket, session bucket,
 * and an agent's cost bucket never collide in the same map:
 *
 * - `checkRequestRate` — requests/minute per visitor. Called from
 *   `authorizeAgentRequest`, immediately after the origin check, so it
 *   applies to every browser-facing endpoint an agent has.
 * - `checkMessageQuota` / `precheckDailyBudget` / `chargeDailyBudget` — chat
 *   specific. Called directly from the chat route, because only a chat turn
 *   has a "message" to count or a run whose token usage to charge.
 *
 * The generated `server.mjs` (`agent-runtime-server.ts`) mirrors this same
 * logic in plain JavaScript for the bare-Node bundle — see that file's
 * `checkRate`/`RATE_LIMITS` section.
 */

import { NextRequest } from 'next/server';
import {
  dailyBucket,
  MemoryRateLimiter,
  MESSAGES_PER_SESSION,
  REQUESTS_PER_MINUTE,
  trustedClientIp,
  visitorRateLimitKey,
  type RateLimitDecision,
} from '@larkup/agent-contracts/rate-limit';

/** One process, one budget — matches `IdempotencyStore`'s in-memory default. */
const limiter = new MemoryRateLimiter();

function visitorKey(agentId: string, req: NextRequest): string {
  const ip = trustedClientIp(req.headers.get('x-forwarded-for'));
  const userAgent = req.headers.get('user-agent') ?? 'unknown';
  return visitorRateLimitKey(agentId, ip, userAgent);
}

/** Requests/minute per visitor (burst 5, sustains 20/min — fixed, not operator-configurable). */
export function checkRequestRate(agentId: string, req: NextRequest): RateLimitDecision {
  return limiter.consume(`req:${visitorKey(agentId, req)}`, 1, REQUESTS_PER_MINUTE);
}

/**
 * Messages/session (hard cap of 50, no refill within a session's life).
 *
 * The widget carries no cookie or session id by design (ADR-004,
 * `use-agent-chat.ts` — "no localStorage/sessionStorage persistence"), so a
 * browser-originated chat turn has no real session to key on. It falls back
 * to the same visitor key the request-rate limit uses — the identical
 * IP+UA imprecision plan §8.5 already accepts there (shared NAT undercounts
 * distinct visitors), not a new weakening. A channel turn *does* have a real
 * session (`channelId:conversationId`, `packages/core/src/session-store.ts`)
 * and should pass it as `sessionKey` for a precise bucket.
 */
export function checkMessageQuota(
  agentId: string,
  req: NextRequest,
  sessionKey?: string,
): RateLimitDecision {
  const key = sessionKey ?? visitorKey(agentId, req);
  return limiter.consume(`msg:${key}`, 1, MESSAGES_PER_SESSION);
}

/**
 * Is this agent already over its (optional) daily token ceiling?
 *
 * Called *before* a run starts. `undefined`/`0` means the operator has not
 * set a ceiling (off by default, plan §8.5) — always allowed, and no bucket
 * is created, so the common case costs nothing.
 */
export function precheckDailyBudget(
  agentId: string,
  ceiling: number | undefined,
): RateLimitDecision {
  if (!ceiling) return { allowed: true, remaining: Infinity, retryAfterSeconds: 0 };
  return limiter.consume(`cost:${agentId}`, 0, dailyBucket(ceiling));
}

/**
 * Record a run's actual token usage against the daily ceiling. Called
 * *after* a run completes — the cost is not known before then, so this never
 * blocks; it only means the *next* `precheckDailyBudget` may start denying.
 */
export function chargeDailyBudget(
  agentId: string,
  tokens: number,
  ceiling: number | undefined,
): void {
  if (!ceiling || !tokens) return;
  limiter.charge(`cost:${agentId}`, tokens, dailyBucket(ceiling));
}

/**
 * The response for any denied limit. `429` with `Retry-After` and
 * `X-RateLimit-Remaining`, mirroring the shape `agent-access.ts` uses for a
 * denied origin/auth check.
 */
export function rateLimitResponse(
  decision: RateLimitDecision,
  cors: Record<string, string>,
): Response {
  return new Response(JSON.stringify({ error: 'Too many requests. Try again shortly.' }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json',
      'Retry-After': String(decision.retryAfterSeconds),
      'X-RateLimit-Remaining': String(Math.max(0, decision.remaining)),
      ...cors,
    },
  });
}
