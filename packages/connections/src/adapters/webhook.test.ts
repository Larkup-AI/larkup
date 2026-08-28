import { describe, expect, it } from 'vitest';
import { computeWebhookSignature, webhookChannel } from './webhook';
import { validateChannelSettings } from '../validate';
import type { InboundRequest } from '../types';

const SECRET = 'whsec_test';

function signed(body: unknown, options: { secret?: string; timestamp?: string } = {}) {
  const rawBody = JSON.stringify(body);
  const timestamp = options.timestamp ?? String(Date.now());
  const signature = computeWebhookSignature(options.secret ?? SECRET, timestamp, rawBody);

  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-larkup-timestamp': timestamp,
      'x-larkup-signature': signature,
    },
    rawBody,
    body,
    query: {},
  } satisfies InboundRequest;
}

describe('webhook verify', () => {
  it('accepts a correctly signed request', () => {
    const result = webhookChannel.verify(signed({ message: 'hi' }), { signingSecret: SECRET });
    expect(result).toEqual({ ok: true });
  });

  it('rejects a request signed with the wrong secret', () => {
    const request = signed({ message: 'hi' }, { secret: 'attacker-secret' });
    const result = webhookChannel.verify(request, { signingSecret: SECRET });
    expect(result).toMatchObject({ ok: false, status: 401 });
  });

  it('rejects a tampered body even when the signature is well-formed', () => {
    const request = signed({ message: 'hi' });
    const tampered = { ...request, rawBody: JSON.stringify({ message: 'transfer all funds' }) };
    expect(webhookChannel.verify(tampered, { signingSecret: SECRET })).toMatchObject({ ok: false });
  });

  it('rejects a replayed request outside the timestamp window', () => {
    const old = String(Date.now() - 10 * 60 * 1000);
    const result = webhookChannel.verify(signed({ message: 'hi' }, { timestamp: old }), {
      signingSecret: SECRET,
    });
    expect(result).toMatchObject({ ok: false, status: 401 });
  });

  it('rejects a request with no signature headers', () => {
    const result = webhookChannel.verify(
      { method: 'POST', headers: {}, rawBody: '{}', body: {}, query: {} },
      { signingSecret: SECRET },
    );
    expect(result).toMatchObject({ ok: false, status: 401 });
  });

  it('fails closed when the channel has no secret configured', () => {
    const result = webhookChannel.verify(signed({ message: 'hi' }), {});
    expect(result).toMatchObject({ ok: false, status: 403 });
  });
});

describe('webhook parse', () => {
  it('normalizes a message payload', () => {
    const message = webhookChannel.parse(
      signed({
        message: '  Where is my order?  ',
        messageId: 'evt_1',
        conversationId: 'ticket-88',
        userId: 'user-7',
        userName: 'Dana',
      }),
      {},
    );

    expect(message).toMatchObject({
      externalMessageId: 'evt_1',
      conversationId: 'ticket-88',
      endUserId: 'user-7',
      endUserName: 'Dana',
      text: 'Where is my order?',
    });
  });

  it('accepts `text` as an alias for `message`', () => {
    expect(webhookChannel.parse(signed({ text: 'hi' }), {})?.text).toBe('hi');
  });

  it('returns null when there is nothing to answer', () => {
    expect(webhookChannel.parse(signed({ message: '   ' }), {})).toBeNull();
    expect(webhookChannel.parse(signed({ event: 'ping' }), {})).toBeNull();
  });

  it('falls back to the signature as a de-duplication id', () => {
    const request = signed({ message: 'hi' });
    const message = webhookChannel.parse(request, {});
    expect(message?.externalMessageId).toBe(request.headers['x-larkup-signature']);
  });
});

describe('webhook config', () => {
  it('requires a signing secret', () => {
    const result = validateChannelSettings(webhookChannel, {});
    expect(result.ok).toBe(false);
    expect(result.errors.signingSecret).toMatch(/required/i);
  });

  it('rejects a malformed callback URL', () => {
    const result = validateChannelSettings(webhookChannel, {
      signingSecret: 's',
      callbackUrl: 'not a url',
    });
    expect(result.ok).toBe(false);
    expect(result.errors.callbackUrl).toMatch(/valid URL/i);
  });

  it('accepts a complete configuration', () => {
    const result = validateChannelSettings(webhookChannel, {
      signingSecret: 's',
      callbackUrl: 'https://acme.test/reply',
    });
    expect(result).toEqual({ ok: true, errors: {} });
  });

  it('flags an unknown setting rather than ignoring it', () => {
    const result = validateChannelSettings(webhookChannel, {
      signingSecret: 's',
      botToken: 'oops-wrong-channel',
    });
    expect(result.ok).toBe(false);
    expect(result.errors.botToken).toMatch(/Unknown setting/);
  });
});

describe('webhook health', () => {
  it('reports misconfigured without a secret', async () => {
    expect(await webhookChannel.health({})).toMatchObject({ status: 'misconfigured' });
  });

  it('is ready with only a secret — the answer rides the response', async () => {
    expect(await webhookChannel.health({ signingSecret: 's' })).toMatchObject({ status: 'ok' });
  });
});
