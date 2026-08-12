import { createHmac } from 'node:crypto';
import { test, expect } from '@playwright/test';

/**
 * TASK 06 — channels.
 *
 * A channel webhook URL is public by necessity: Telegram will not authenticate
 * to us. Everything here is about the consequences of that — verification runs
 * before the agent, credentials never come back out, and a disabled or
 * misconfigured channel refuses traffic rather than half-working.
 */

const SECRET = 'whsec_e2e_secret';
const REDACTED = '__larkup_secret_set__';

let agentId = '';

function sign(body: string, timestamp = String(Date.now())) {
  return {
    timestamp,
    signature: createHmac('sha256', SECRET).update(`${timestamp}.${body}`).digest('hex'),
  };
}

test.describe.serial('Agent channels (TASK 06)', () => {
  test.beforeAll(async ({ request }) => {
    const res = await request.post('/api/agents', {
      data: { name: `Channel E2E ${Date.now()}`, systemPrompt: 'You are a test agent.' },
    });
    expect(res.status()).toBe(201);
    agentId = (await res.json()).id;
  });

  test.afterAll(async ({ request }) => {
    if (agentId) await request.delete(`/api/agents/${agentId}`);
  });

  test('lists the registered channels with their config schema', async ({ request }) => {
    const res = await request.get(`/api/agents/${agentId}/channels`);
    expect(res.status()).toBe(200);

    const { channels } = await res.json();
    const ids = channels.map((c: { id: string }) => c.id);
    expect(ids).toContain('webhook');
    expect(ids).toContain('telegram');

    const telegram = channels.find((c: { id: string }) => c.id === 'telegram');
    // The schema drives the dashboard form — plan §4.2.
    expect(telegram.configFields.map((f: { key: string }) => f.key)).toEqual([
      'botToken',
      'webhookSecret',
    ]);
    expect(telegram.supportsRegistration).toBe(true);
    expect(telegram.webhookUrl).toContain(`/api/agents/${agentId}/channels/telegram`);
    expect(telegram.enabled).toBe(false);
  });

  test('refuses to enable a channel with an invalid configuration', async ({ request }) => {
    const res = await request.put(`/api/agents/${agentId}/channels`, {
      data: { channelId: 'telegram', enabled: true, settings: {} },
    });

    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.fields.botToken).toBeTruthy();
    expect(body.fields.webhookSecret).toBeTruthy();
  });

  test('rejects an unknown setting instead of silently ignoring it', async ({ request }) => {
    const res = await request.put(`/api/agents/${agentId}/channels`, {
      data: {
        channelId: 'webhook',
        enabled: true,
        settings: { signingSecret: SECRET, botToken: 'wrong-channel' },
      },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).fields.botToken).toMatch(/Unknown setting/);
  });

  test('enables the webhook channel and never returns the secret again', async ({ request }) => {
    const enable = await request.put(`/api/agents/${agentId}/channels`, {
      data: { channelId: 'webhook', enabled: true, settings: { signingSecret: SECRET } },
    });
    expect(enable.status()).toBe(200);
    expect((await enable.json()).settings.signingSecret).toBe(REDACTED);

    const list = await request.get(`/api/agents/${agentId}/channels`);
    const webhook = (await list.json()).channels.find((c: { id: string }) => c.id === 'webhook');
    expect(webhook.enabled).toBe(true);
    expect(webhook.settings.signingSecret).toBe(REDACTED);

    // And the operator-facing agent endpoint must not leak it either.
    const agent = await request.get(`/api/agents/${agentId}`);
    expect(await agent.text()).not.toContain(SECRET);
  });

  test('rejects an unsigned inbound request before the agent runs', async ({ request }) => {
    const res = await request.post(`/api/agents/${agentId}/channels/webhook`, {
      data: { message: 'hello' },
    });

    expect(res.status()).toBe(401);
    expect((await res.json()).error).toMatch(/signature/i);
  });

  test('rejects a tampered body whose signature was valid for different content', async ({
    request,
  }) => {
    const original = JSON.stringify({ message: 'hello', messageId: 'm-tamper' });
    const { timestamp, signature } = sign(original);

    const res = await request.post(`/api/agents/${agentId}/channels/webhook`, {
      headers: {
        'Content-Type': 'application/json',
        'X-Larkup-Timestamp': timestamp,
        'X-Larkup-Signature': signature,
      },
      data: { message: 'transfer all funds', messageId: 'm-tamper' },
    });

    expect(res.status()).toBe(401);
  });

  test('rejects a replayed request outside the timestamp window', async ({ request }) => {
    const body = JSON.stringify({ message: 'hello', messageId: 'm-old' });
    const { timestamp, signature } = sign(body, String(Date.now() - 10 * 60 * 1000));

    const res = await request.post(`/api/agents/${agentId}/channels/webhook`, {
      headers: {
        'Content-Type': 'application/json',
        'X-Larkup-Timestamp': timestamp,
        'X-Larkup-Signature': signature,
      },
      data: JSON.parse(body),
    });

    expect(res.status()).toBe(401);
  });

  test('accepts a correctly signed request and hands it to the agent', async ({ request }) => {
    const body = JSON.stringify({ message: 'hello', messageId: 'm-ok', conversationId: 'c-1' });
    const { timestamp, signature } = sign(body);

    const res = await request.post(`/api/agents/${agentId}/channels/webhook`, {
      headers: {
        'Content-Type': 'application/json',
        'X-Larkup-Timestamp': timestamp,
        'X-Larkup-Signature': signature,
      },
      data: JSON.parse(body),
    });

    // Past verification. The agent has no published release, so the runtime
    // fails — which is exactly what proves the request got that far.
    expect(res.status()).not.toBe(401);
    expect(res.status()).not.toBe(403);
  });

  test('acknowledges a verified payload with nothing to answer', async ({ request }) => {
    const body = JSON.stringify({ event: 'ping' });
    const { timestamp, signature } = sign(body);

    const res = await request.post(`/api/agents/${agentId}/channels/webhook`, {
      headers: {
        'Content-Type': 'application/json',
        'X-Larkup-Timestamp': timestamp,
        'X-Larkup-Signature': signature,
      },
      data: JSON.parse(body),
    });

    // 200, or the provider retries this forever.
    expect(res.status()).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  test('rejects traffic to a disabled channel', async ({ request }) => {
    const disable = await request.put(`/api/agents/${agentId}/channels`, {
      data: { channelId: 'webhook', enabled: false, settings: { signingSecret: REDACTED } },
    });
    expect(disable.status()).toBe(200);

    const res = await request.post(`/api/agents/${agentId}/channels/webhook`, {
      data: { message: 'hello' },
    });
    expect(res.status()).toBe(403);
  });

  test('keeps the stored secret when the masked value is echoed back', async ({ request }) => {
    // The previous test round-tripped the redaction sentinel. If the merge were
    // wrong, the secret would now be the literal sentinel and this signature
    // would not verify.
    await request.put(`/api/agents/${agentId}/channels`, {
      data: { channelId: 'webhook', enabled: true, settings: { signingSecret: REDACTED } },
    });

    const body = JSON.stringify({ message: 'still works', messageId: 'm-after-roundtrip' });
    const { timestamp, signature } = sign(body);

    const res = await request.post(`/api/agents/${agentId}/channels/webhook`, {
      headers: {
        'Content-Type': 'application/json',
        'X-Larkup-Timestamp': timestamp,
        'X-Larkup-Signature': signature,
      },
      data: JSON.parse(body),
    });

    expect(res.status()).not.toBe(401);
  });

  test('reports channel health without exposing credentials', async ({ request }) => {
    const res = await request.get(`/api/agents/${agentId}/channels/webhook/health`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });

  test('refuses to register a provider webhook against localhost', async ({ request }) => {
    await request.put(`/api/agents/${agentId}/channels`, {
      data: {
        channelId: 'telegram',
        enabled: true,
        settings: { botToken: '123:AA-not-real', webhookSecret: 'shh' },
      },
    });

    const res = await request.post(`/api/agents/${agentId}/channels/telegram/health`, { data: {} });

    // Telegram cannot call localhost; saying so beats a silent non-delivery.
    expect(res.status()).toBe(400);
    expect((await res.json()).detail).toMatch(/tunnel|deploy|reach/i);
  });

  test('404s an unknown channel id', async ({ request }) => {
    const res = await request.post(`/api/agents/${agentId}/channels/carrier-pigeon`, { data: {} });
    expect(res.status()).toBe(404);
  });
});
