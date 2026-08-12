import { test, expect } from '@playwright/test';

/**
 * plan §8.5 — rate limiting on browser-facing Agent endpoints.
 *
 * The origin allow-list (covered in `agent-widget.spec.ts`) answers *who* may
 * call an agent; this covers *how much*. Of the three limits, only
 * requests/minute is practical to trip from an E2E test in reasonable time —
 * messages/session (50, no refill) and the daily token ceiling need either
 * 50+ requests or a real model call to observe end to end. Both share the
 * exact token-bucket primitive and the exact `rateLimitResponse` plumbing
 * this file proves works, and are covered at the unit level in
 * `packages/agent-contracts/src/rate-limit.test.ts`.
 *
 * Every test here uses its own synthetic `X-Forwarded-For` visitor so tests
 * do not interfere with each other's budget.
 */

let agentId = '';
let visitorSeq = 0;
function freshVisitor(): { 'X-Forwarded-For': string } {
  visitorSeq += 1;
  return { 'X-Forwarded-For': `10.30.0.${visitorSeq}` };
}

test.describe.serial('Agent rate limiting (plan §8.5)', () => {
  test.beforeAll(async ({ request }) => {
    const res = await request.post('/api/agents', {
      data: {
        name: `Rate Limit E2E ${Date.now()}`,
        description: 'Created by e2e/tests/api/agent-rate-limit.spec.ts',
        systemPrompt: 'You are a test agent.',
        allowedOrigins: ['*'],
      },
    });
    expect(res.status()).toBe(201);
    agentId = (await res.json()).id;
  });

  test.afterAll(async ({ request }) => {
    if (agentId) await request.delete(`/api/agents/${agentId}`);
  });

  test('the 6th request within a burst from one visitor is denied with 429 and Retry-After', async ({
    request,
  }) => {
    const visitor = freshVisitor();

    // Burst capacity is 5 (plan §8.5's fixed default) — the first 5 pass the
    // rate check (whatever else happens to them, e.g. a 409 for no release).
    for (let i = 0; i < 5; i += 1) {
      const res = await request.post(`/api/agents/${agentId}/chat`, {
        headers: visitor,
        data: { messages: [{ role: 'user', content: `msg ${i}` }] },
      });
      expect(res.status(), `request ${i} should not be rate-limited yet`).not.toBe(429);
    }

    const sixth = await request.post(`/api/agents/${agentId}/chat`, {
      headers: visitor,
      data: { messages: [{ role: 'user', content: 'one too many' }] },
    });
    expect(sixth.status()).toBe(429);
    expect(sixth.headers()['retry-after']).toBeTruthy();
    expect(Number(sixth.headers()['retry-after'])).toBeGreaterThan(0);
    expect(sixth.headers()['x-ratelimit-remaining']).toBe('0');

    const body = await sixth.json();
    expect(body.error).toBeTruthy();
  });

  test('a different visitor (different X-Forwarded-For) has an independent budget', async ({
    request,
  }) => {
    const first = freshVisitor();
    for (let i = 0; i < 5; i += 1) {
      await request.post(`/api/agents/${agentId}/chat`, {
        headers: first,
        data: { messages: [{ role: 'user', content: `msg ${i}` }] },
      });
    }
    const exhausted = await request.post(`/api/agents/${agentId}/chat`, {
      headers: first,
      data: { messages: [{ role: 'user', content: 'blocked' }] },
    });
    expect(exhausted.status()).toBe(429);

    // A second visitor, same agent, has never spent from this bucket.
    const second = freshVisitor();
    const res = await request.post(`/api/agents/${agentId}/chat`, {
      headers: second,
      data: { messages: [{ role: 'user', content: 'fresh visitor' }] },
    });
    expect(res.status()).not.toBe(429);
  });

  test('the request-rate limit also applies to GET /public, not just /chat', async ({
    request,
  }) => {
    const visitor = freshVisitor();
    for (let i = 0; i < 5; i += 1) {
      await request.get(`/api/agents/${agentId}/public`, { headers: visitor });
    }
    const sixth = await request.get(`/api/agents/${agentId}/public`, { headers: visitor });
    expect(sixth.status()).toBe(429);
  });

  test('a rate-limit denial still carries CORS headers so the browser reports it, not "Failed to fetch"', async ({
    request,
  }) => {
    const visitor = freshVisitor();
    const origin = 'https://shop.example.com';
    await request.put(`/api/agents/${agentId}`, { data: { allowedOrigins: [origin] } });

    for (let i = 0; i < 5; i += 1) {
      await request.post(`/api/agents/${agentId}/chat`, {
        headers: { Origin: origin, ...visitor },
        data: { messages: [{ role: 'user', content: `msg ${i}` }] },
      });
    }
    const denied = await request.post(`/api/agents/${agentId}/chat`, {
      headers: { Origin: origin, ...visitor },
      data: { messages: [{ role: 'user', content: 'blocked' }] },
    });
    expect(denied.status()).toBe(429);
    expect(denied.headers()['access-control-allow-origin']).toBe(origin);

    await request.put(`/api/agents/${agentId}`, { data: { allowedOrigins: ['*'] } });
  });

  test('a blocked origin is refused before it ever touches the rate limiter', async ({
    request,
  }) => {
    // Regression guard for the check ordering in `authorizeAgentRequest`:
    // origin is checked first, so a hostile scraped-snippet replay from a
    // non-allow-listed site gets a 403 explaining why, not a 429 that implies
    // it was ever going to be allowed to spend budget.
    const origin = 'https://not-allowed.example.com';
    await request.put(`/api/agents/${agentId}`, {
      data: { allowedOrigins: ['https://only-this.example.com'] },
    });

    const res = await request.post(`/api/agents/${agentId}/chat`, {
      headers: { Origin: origin, ...freshVisitor() },
      data: { messages: [{ role: 'user', content: 'hello' }] },
    });
    expect(res.status()).toBe(403);

    await request.put(`/api/agents/${agentId}`, { data: { allowedOrigins: ['*'] } });
  });

  /* -------------------------------------------------------------- */
  /* Daily token ceiling — settings round-trip (runtime charging is  */
  /* unit-tested in rate-limit.test.ts; it needs a real model call   */
  /* to observe end to end, and this suite runs without credentials) */
  /* -------------------------------------------------------------- */

  test('a daily token ceiling can be set, read back, and cleared', async ({ request }) => {
    const set = await request.put(`/api/agents/${agentId}`, {
      data: { dailyTokenCeiling: 50000 },
    });
    expect(set.status()).toBe(200);
    expect((await set.json()).dailyTokenCeiling).toBe(50000);

    const read = await request.get(`/api/agents/${agentId}`);
    expect((await read.json()).dailyTokenCeiling).toBe(50000);

    const cleared = await request.put(`/api/agents/${agentId}`, {
      data: { dailyTokenCeiling: 0 },
    });
    expect((await cleared.json()).dailyTokenCeiling).toBe(0);
  });
});
