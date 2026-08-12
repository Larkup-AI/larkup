import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { slackChannel, slackUrlVerificationChallenge, splitForSlack } from './slack';
import { validateChannelSettings } from '../validate';
import type { InboundRequest } from '../types';

const SETTINGS = { botToken: 'xoxb-test', signingSecret: 'shh' };

function sign(body: string, secret = 'shh', timestamp = String(Math.floor(Date.now() / 1000))) {
  const signature =
    'v0=' + createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex');
  return { timestamp, signature };
}

function request(payload: unknown, overrides: Partial<InboundRequest> = {}): InboundRequest {
  const rawBody = JSON.stringify(payload);
  const { timestamp, signature } = sign(rawBody);
  return {
    method: 'POST',
    headers: { 'x-slack-request-timestamp': timestamp, 'x-slack-signature': signature },
    rawBody,
    body: payload,
    query: {},
    ...overrides,
  };
}

function messageEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: 'event_callback',
    event_id: 'Ev0123456',
    event: {
      type: 'message',
      channel: 'C0123456',
      user: 'U0123456',
      text: 'Where is my order?',
      ts: '1700000000.000100',
      ...overrides,
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('slack verify', () => {
  it('accepts a correctly signed request', () => {
    expect(slackChannel.verify(request(messageEvent()), SETTINGS)).toEqual({ ok: true });
  });

  it('rejects a wrong signature', () => {
    const req = request(messageEvent());
    req.headers['x-slack-signature'] = 'v0=' + '0'.repeat(64);
    expect(slackChannel.verify(req, SETTINGS)).toMatchObject({ ok: false, status: 401 });
  });

  it('rejects a body that does not match the signature (tamper after signing)', () => {
    const req = request(messageEvent());
    req.rawBody = JSON.stringify(messageEvent({ text: 'tampered' }));
    expect(slackChannel.verify(req, SETTINGS)).toMatchObject({ ok: false, status: 401 });
  });

  it('rejects missing signature headers', () => {
    const req = request(messageEvent(), { headers: {} });
    expect(slackChannel.verify(req, SETTINGS)).toMatchObject({ ok: false, status: 401 });
  });

  it('rejects a stale timestamp — the replay-window guard', () => {
    const rawBody = JSON.stringify(messageEvent());
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 6 * 60); // 6 minutes old
    const { signature } = sign(rawBody, 'shh', staleTimestamp);
    const req: InboundRequest = {
      method: 'POST',
      headers: { 'x-slack-request-timestamp': staleTimestamp, 'x-slack-signature': signature },
      rawBody,
      body: JSON.parse(rawBody),
      query: {},
    };
    expect(slackChannel.verify(req, SETTINGS)).toMatchObject({ ok: false, status: 401 });
  });

  it('fails closed when the channel has no signing secret configured', () => {
    expect(slackChannel.verify(request(messageEvent()), { botToken: 'xoxb-test' })).toMatchObject({
      ok: false,
      status: 403,
    });
  });
});

describe('slack parse', () => {
  it('normalizes a message event', () => {
    expect(slackChannel.parse(request(messageEvent()), SETTINGS)).toEqual({
      externalMessageId: 'Ev0123456',
      conversationId: 'C0123456',
      endUserId: 'U0123456',
      text: 'Where is my order?',
      replyContext: { channel: 'C0123456' },
    });
  });

  it('falls back to channel:ts when event_id is absent, still stable across retries', () => {
    const payload = messageEvent();
    delete (payload as { event_id?: string }).event_id;
    expect(slackChannel.parse(request(payload), SETTINGS)?.externalMessageId).toBe(
      'C0123456:1700000000.000100',
    );
  });

  it('ignores a message with a subtype — an edit, delete, or bot relay', () => {
    const edited = messageEvent({ subtype: 'message_changed' });
    expect(slackChannel.parse(request(edited), SETTINGS)).toBeNull();
  });

  it('never answers another bot, even without a subtype', () => {
    const fromBot = messageEvent({ bot_id: 'B999' });
    expect(slackChannel.parse(request(fromBot), SETTINGS)).toBeNull();
  });

  it('ignores a non-message event type', () => {
    const reaction = { type: 'event_callback', event: { type: 'reaction_added' } };
    expect(slackChannel.parse(request(reaction), SETTINGS)).toBeNull();
  });

  it('ignores an event_callback with no event payload', () => {
    expect(slackChannel.parse(request({ type: 'event_callback' }), SETTINGS)).toBeNull();
  });

  it('returns null for an empty-text message', () => {
    const empty = messageEvent({ text: '' });
    expect(slackChannel.parse(request(empty), SETTINGS)).toBeNull();
  });

  it('does not treat a url_verification payload as a message', () => {
    const handshake = { type: 'url_verification', challenge: 'abc' };
    expect(slackChannel.parse(request(handshake), SETTINGS)).toBeNull();
  });
});

describe('slackUrlVerificationChallenge', () => {
  it('extracts the challenge from a url_verification payload', () => {
    expect(
      slackUrlVerificationChallenge({ type: 'url_verification', challenge: 'abc123' }),
    ).toEqual({ challenge: 'abc123' });
  });

  it('returns null for a message event', () => {
    expect(slackUrlVerificationChallenge(messageEvent())).toBeNull();
  });

  it('returns null for a malformed or missing body', () => {
    expect(slackUrlVerificationChallenge(undefined)).toBeNull();
    expect(slackUrlVerificationChallenge({ type: 'url_verification' })).toBeNull();
    expect(slackUrlVerificationChallenge('not an object')).toBeNull();
  });
});

describe('slack send', () => {
  it('posts to chat.postMessage with the bot token and returns the message ts', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true, ts: '1700000000.000200' }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await slackChannel.send(
      { conversationId: 'C1', text: 'hi', replyContext: { channel: 'C1' } },
      SETTINGS,
    );

    expect(result).toEqual({ ok: true, externalMessageId: '1700000000.000200' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://slack.com/api/chat.postMessage');
    expect(init.headers.Authorization).toBe('Bearer xoxb-test');
    expect(JSON.parse(init.body)).toEqual({ channel: 'C1', text: 'hi' });
  });

  it('treats ok: false in a 200 response as a failure — Slack does not use HTTP status for API errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ ok: false, error: 'not_in_channel' }), { status: 200 }),
        ),
    );
    const result = await slackChannel.send(
      { conversationId: 'C1', text: 'hi', replyContext: { channel: 'C1' } },
      SETTINGS,
    );
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('not_in_channel') });
  });

  it('reports a 429 as retryable with the Retry-After delay', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('', { status: 429, headers: { 'retry-after': '5' } })),
    );
    const result = await slackChannel.send(
      { conversationId: 'C1', text: 'hi', replyContext: { channel: 'C1' } },
      SETTINGS,
    );
    expect(result).toMatchObject({ ok: false, retryable: true, retryAfterMs: 5000 });
  });

  it('refuses to send with no bot token configured', async () => {
    const result = await slackChannel.send(
      { conversationId: 'C1', text: 'hi', replyContext: { channel: 'C1' } },
      { signingSecret: 'shh' },
    );
    expect(result).toEqual({ ok: false, error: 'No bot token configured.', retryable: false });
  });
});

describe('splitForSlack', () => {
  it('leaves a short answer untouched', () => {
    expect(splitForSlack('hello')).toEqual(['hello']);
  });

  it('splits on a paragraph boundary when it can', () => {
    const text = `${'a'.repeat(60)}\n\n${'b'.repeat(60)}`;
    expect(splitForSlack(text, 100)).toEqual(['a'.repeat(60), 'b'.repeat(60)]);
  });

  it('keeps every chunk inside the 40,000-character limit', () => {
    const chunks = splitForSlack('word '.repeat(20_000));
    expect(chunks.every((c) => c.length <= 40_000)).toBe(true);
  });
});

describe('slack config', () => {
  it('requires both the bot token and the signing secret', () => {
    const result = validateChannelSettings(slackChannel, {});
    expect(result.ok).toBe(false);
    expect(Object.keys(result.errors).sort()).toEqual(['botToken', 'signingSecret']);
  });

  it('accepts a complete configuration', () => {
    expect(validateChannelSettings(slackChannel, SETTINGS)).toEqual({ ok: true, errors: {} });
  });
});

describe('slack health', () => {
  it('reports misconfigured before any network call when settings are missing', async () => {
    expect(await slackChannel.health({})).toMatchObject({ status: 'misconfigured' });
    expect(await slackChannel.health({ botToken: 'xoxb-test' })).toMatchObject({
      status: 'misconfigured',
    });
  });

  it('reports ok with the bot identity on a successful auth.test', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true, user: 'larkupbot', team: 'Acme' }), {
          status: 200,
        }),
      ),
    );
    const health = await slackChannel.health(SETTINGS);
    expect(health).toEqual({
      status: 'ok',
      detail: 'Connected as @larkupbot on Acme.',
      identity: '@larkupbot',
    });
  });

  it('reports misconfigured when Slack rejects the token', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ ok: false, error: 'invalid_auth' }), { status: 200 }),
        ),
    );
    expect(await slackChannel.health(SETTINGS)).toMatchObject({ status: 'misconfigured' });
  });

  it('reports unreachable when the network call itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await slackChannel.health(SETTINGS)).toMatchObject({ status: 'unreachable' });
  });
});

describe('slack has no automatic webhook registration', () => {
  it('does not implement registerWebhook, unlike Telegram', () => {
    expect(slackChannel.registerWebhook).toBeUndefined();
  });
});
