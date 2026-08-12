import { test, expect } from '@playwright/test';

/**
 * TASK 05 — Agent Widget / SDK.
 *
 * Covers the browser-facing boundary: the widget carries only a public Agent ID
 * (ADR-004), so the agent's allowed-origins list is the control that stops an
 * arbitrary website from spending the operator's model budget. These tests
 * exercise that gate against a running dev server, plus the two endpoints the
 * widget depends on (`/api/widget.js` and `/api/agents/:id/public`).
 *
 * No model credentials are needed: every assertion is about authorization,
 * redaction, and transport — the chat stream itself is covered elsewhere.
 */

const ALLOWED_ORIGIN = 'https://allowed.example.com';
const BLOCKED_ORIGIN = 'https://evil.example.com';

/**
 * A fresh synthetic IP per test.
 *
 * All requests in this file share one agent id, one real source IP (the test
 * runner), and one default User-Agent — which is exactly the visitor-rate-
 * limit bucket key (plan §8.5, `agent-rate-limit.ts`). Without this, this
 * file's own request volume (far more than the 5-request burst) would trip
 * the limiter and fail tests that have nothing to do with rate limiting.
 * `trustedClientIp` trusts the *last* `X-Forwarded-For` hop, which nothing
 * upstream rewrites in this dev-server setup, so this is a legitimate way to
 * present as a distinct visitor per test rather than a spoof of production
 * trust.
 */
let visitorSeq = 0;
function freshVisitor(): { 'X-Forwarded-For': string } {
  visitorSeq += 1;
  return { 'X-Forwarded-For': `10.10.0.${visitorSeq}` };
}

let agentId = '';

test.describe.serial('Agent Widget embedding (TASK 05)', () => {
  test.beforeAll(async ({ request }) => {
    const res = await request.post('/api/agents', {
      data: {
        name: `Widget E2E ${Date.now()}`,
        description: 'Created by e2e/tests/api/agent-widget.spec.ts',
        systemPrompt: 'You are a test agent.',
        allowedOrigins: [ALLOWED_ORIGIN, 'https://*.wildcard.example.com'],
      },
    });
    expect(res.status()).toBe(201);
    agentId = (await res.json()).id;
    expect(agentId).toBeTruthy();
  });

  test.afterAll(async ({ request }) => {
    if (agentId) await request.delete(`/api/agents/${agentId}`);
  });

  /* ---------------------------------------------------------------- */
  /* Bundle delivery                                                   */
  /* ---------------------------------------------------------------- */

  test('GET /api/widget.js serves the widget bundle to any origin', async ({ request }) => {
    const res = await request.get('/api/widget.js');

    // 503 means the bundle has not been built in this checkout; the endpoint
    // still has to answer with JavaScript so a host page fails loudly.
    expect([200, 503]).toContain(res.status());
    expect(res.headers()['content-type']).toContain('javascript');

    if (res.status() === 503) {
      test.info().annotations.push({
        type: 'warning',
        description: 'widget bundle not built — run `pnpm --filter @larkup/agent-widget build`',
      });
      return;
    }

    expect(res.headers()['access-control-allow-origin']).toBe('*');
    expect(res.headers()['cache-control']).toContain('max-age');
    expect(res.headers()['x-content-type-options']).toBe('nosniff');
    expect(res.headers()['etag']).toBeTruthy();

    const body = await res.text();
    expect(body).toContain('LarkupAgent');
  });

  test('GET /api/widget.js revalidates with an ETag', async ({ request }) => {
    const first = await request.get('/api/widget.js');
    test.skip(first.status() !== 200, 'widget bundle not built');

    const etag = first.headers()['etag'];
    const second = await request.get('/api/widget.js', { headers: { 'If-None-Match': etag } });
    expect(second.status()).toBe(304);
  });

  /* ---------------------------------------------------------------- */
  /* Public config redaction                                           */
  /* ---------------------------------------------------------------- */

  test('GET /api/agents/:id/public never exposes prompts or credentials', async ({ request }) => {
    const res = await request.get(`/api/agents/${agentId}/public`, {
      headers: { Origin: ALLOWED_ORIGIN, ...freshVisitor() },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.agentId).toBe(agentId);
    expect(body).toHaveProperty('widgetStyle');
    expect(body).toHaveProperty('status');
    expect(body.authMode).toBe('none');

    // The whole point of this endpoint: none of these may reach a browser.
    expect(body).not.toHaveProperty('systemPrompt');
    expect(body).not.toHaveProperty('knowledgeSources');
    expect(body).not.toHaveProperty('enabledToolIds');
    expect(body).not.toHaveProperty('chatProvider');
    expect(JSON.stringify(body)).not.toContain('retrievalKey');
  });

  test('GET /api/agents/:id/public is blocked from a non-allow-listed origin', async ({
    request,
  }) => {
    const res = await request.get(`/api/agents/${agentId}/public`, {
      headers: { Origin: BLOCKED_ORIGIN },
    });
    expect(res.status()).toBe(403);

    // The denial is deliberately readable cross-origin — it carries no agent
    // data, and hiding it behind an opaque CORS failure would leave an embedder
    // with no idea why their widget is dead. See `agentCorsHeaders`.
    expect(res.headers()['access-control-allow-origin']).toBe(BLOCKED_ORIGIN);
    expect(await res.text()).not.toContain('systemPrompt');
  });

  /* ---------------------------------------------------------------- */
  /* Origin whitelisting on the chat route                             */
  /* ---------------------------------------------------------------- */

  test('OPTIONS preflight succeeds for an allow-listed origin', async ({ request }) => {
    const res = await request.fetch(`/api/agents/${agentId}/chat`, {
      method: 'OPTIONS',
      headers: {
        Origin: ALLOWED_ORIGIN,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });

    expect(res.status()).toBe(204);
    expect(res.headers()['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    expect(res.headers()['access-control-allow-methods']).toContain('POST');
    expect(res.headers()['access-control-allow-headers'].toLowerCase()).toContain('content-type');
    // Without Vary a shared cache could replay one site's CORS grant to another.
    expect(res.headers()['vary']).toContain('Origin');
  });

  test('OPTIONS preflight is rejected for a blocked origin', async ({ request }) => {
    const res = await request.fetch(`/api/agents/${agentId}/chat`, {
      method: 'OPTIONS',
      headers: { Origin: BLOCKED_ORIGIN, 'Access-Control-Request-Method': 'POST' },
    });

    // A non-2xx preflight fails the request in the browser regardless of the
    // headers on it — this is the enforcement point for the chat endpoint.
    expect(res.status()).toBe(403);
  });

  test('POST /chat returns 403 for a non-allow-listed origin', async ({ request }) => {
    const res = await request.post(`/api/agents/${agentId}/chat`, {
      headers: { Origin: BLOCKED_ORIGIN },
      data: { messages: [{ role: 'user', content: 'hello' }] },
    });

    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.error).toContain(BLOCKED_ORIGIN);
  });

  test('POST /chat accepts a wildcard-subdomain origin', async ({ request }) => {
    const res = await request.post(`/api/agents/${agentId}/chat`, {
      headers: { Origin: 'https://shop.wildcard.example.com', ...freshVisitor() },
      data: { messages: [{ role: 'user', content: 'hello' }] },
    });

    // Past the origin gate. The agent has no published release, so the runtime
    // answers 409 — which is exactly the proof that authorization succeeded.
    expect(res.status()).not.toBe(403);
    expect(res.headers()['access-control-allow-origin']).toBe('https://shop.wildcard.example.com');
  });

  test('POST /chat rejects a wildcard lookalike domain', async ({ request }) => {
    const res = await request.post(`/api/agents/${agentId}/chat`, {
      headers: { Origin: 'https://wildcard.example.com.evil.com' },
      data: { messages: [{ role: 'user', content: 'hello' }] },
    });
    expect(res.status()).toBe(403);
  });

  test('POST /chat allows a server-to-server call with no Origin header', async ({ request }) => {
    const res = await request.post(`/api/agents/${agentId}/chat`, {
      headers: { ...freshVisitor() },
      data: { messages: [{ role: 'user', content: 'hello' }] },
    });
    expect(res.status()).not.toBe(403);
  });

  test('POST /chat rejects an empty message list before touching the model', async ({
    request,
  }) => {
    const res = await request.post(`/api/agents/${agentId}/chat`, {
      headers: { ...freshVisitor() },
      data: { messages: [] },
    });
    expect(res.status()).toBe(400);
  });

  test('POST /chat accepts AI SDK UIMessage parts as well as flat content', async ({ request }) => {
    const res = await request.post(`/api/agents/${agentId}/chat`, {
      headers: { ...freshVisitor() },
      data: { messages: [{ role: 'user', parts: [{ type: 'text', text: 'hello' }] }] },
    });
    // Anything but 400 proves the parts payload normalized to a real message.
    expect(res.status()).not.toBe(400);
  });

  /* ---------------------------------------------------------------- */
  /* Live allow-list changes                                           */
  /* ---------------------------------------------------------------- */

  test('revoking an origin takes effect without republishing a release', async ({ request }) => {
    const visitor = freshVisitor();
    const before = await request.post(`/api/agents/${agentId}/chat`, {
      headers: { Origin: ALLOWED_ORIGIN, ...visitor },
      data: { messages: [{ role: 'user', content: 'hello' }] },
    });
    expect(before.status()).not.toBe(403);

    const update = await request.put(`/api/agents/${agentId}`, {
      data: { allowedOrigins: ['https://*.wildcard.example.com'] },
    });
    expect(update.status()).toBe(200);

    const after = await request.post(`/api/agents/${agentId}/chat`, {
      headers: { Origin: ALLOWED_ORIGIN, ...visitor },
      data: { messages: [{ role: 'user', content: 'hello' }] },
    });
    expect(after.status()).toBe(403);
  });

  test('an agent with an empty allow-list rejects every cross-origin embed', async ({
    request,
  }) => {
    const update = await request.put(`/api/agents/${agentId}`, { data: { allowedOrigins: [] } });
    expect(update.status()).toBe(200);

    const res = await request.post(`/api/agents/${agentId}/chat`, {
      headers: { Origin: ALLOWED_ORIGIN },
      data: { messages: [{ role: 'user', content: 'hello' }] },
    });
    expect(res.status()).toBe(403);
    expect((await res.json()).error).toContain('empty');
  });

  /* ---------------------------------------------------------------- */
  /* Join-code agents                                                  */
  /* ---------------------------------------------------------------- */

  test('a join-code agent requires the code on every widget request', async ({ request }) => {
    await request.put(`/api/agents/${agentId}`, {
      data: { allowedOrigins: [ALLOWED_ORIGIN], authMode: 'join-code', joinCode: 'sesame' },
    });

    const without = await request.get(`/api/agents/${agentId}/public`, {
      headers: { Origin: ALLOWED_ORIGIN, ...freshVisitor() },
    });
    expect(without.status()).toBe(401);

    const wrong = await request.get(`/api/agents/${agentId}/public`, {
      headers: { Origin: ALLOWED_ORIGIN, 'X-Larkup-Join-Code': 'guess', ...freshVisitor() },
    });
    expect(wrong.status()).toBe(401);

    const correct = await request.get(`/api/agents/${agentId}/public`, {
      headers: { Origin: ALLOWED_ORIGIN, 'X-Larkup-Join-Code': 'sesame', ...freshVisitor() },
    });
    expect(correct.status()).toBe(200);
  });

  test('an unknown agent id is a 404 for widget endpoints', async ({ request }) => {
    const res = await request.get('/api/agents/does-not-exist-xyz/public', {
      headers: { Origin: ALLOWED_ORIGIN },
    });
    expect(res.status()).toBe(404);
  });
});
