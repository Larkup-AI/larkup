import { describe, expect, it } from 'vitest';
import { splitForTelegram, telegramChannel } from './telegram';
import { validateChannelSettings } from '../validate';
import type { InboundRequest } from '../types';

const SETTINGS = { botToken: '123:AA', webhookSecret: 'shh' };

function update(body: unknown, secret = 'shh'): InboundRequest {
  return {
    method: 'POST',
    headers: { 'x-telegram-bot-api-secret-token': secret },
    rawBody: JSON.stringify(body),
    body,
    query: {},
  };
}

/** A realistic `message` update, trimmed to the fields the adapter reads. */
function message(overrides: Record<string, unknown> = {}) {
  return {
    update_id: 100,
    message: {
      message_id: 5,
      date: 1_700_000_000,
      text: 'Where is my order?',
      from: { id: 441122, is_bot: false, first_name: 'Dana', username: 'dana' },
      chat: { id: -900, type: 'private' },
      ...overrides,
    },
  };
}

describe('telegram verify', () => {
  it('accepts the configured secret token', () => {
    expect(telegramChannel.verify(update(message()), SETTINGS)).toEqual({ ok: true });
  });

  it('rejects a wrong secret token', () => {
    expect(telegramChannel.verify(update(message(), 'guess'), SETTINGS)).toMatchObject({
      ok: false,
      status: 401,
    });
  });

  it('rejects an update with no secret token header at all', () => {
    const request: InboundRequest = {
      method: 'POST',
      headers: {},
      rawBody: '{}',
      body: {},
      query: {},
    };
    expect(telegramChannel.verify(request, SETTINGS)).toMatchObject({ ok: false, status: 401 });
  });

  it('fails closed when the channel has no secret configured', () => {
    expect(telegramChannel.verify(update(message()), { botToken: '123:AA' })).toMatchObject({
      ok: false,
      status: 403,
    });
  });
});

describe('telegram parse', () => {
  it('normalizes a text message', () => {
    expect(telegramChannel.parse(update(message()), SETTINGS)).toMatchObject({
      externalMessageId: '100',
      conversationId: '-900',
      endUserId: '441122',
      endUserName: 'Dana @dana',
      text: 'Where is my order?',
      replyContext: { chatId: -900 },
    });
  });

  it('ignores an edited message, which Telegram would otherwise re-deliver', () => {
    const edited = { update_id: 101, edited_message: message().message };
    expect(telegramChannel.parse(update(edited), SETTINGS)).toBeNull();
  });

  it('ignores a channel post', () => {
    const post = { update_id: 102, channel_post: message().message };
    expect(telegramChannel.parse(update(post), SETTINGS)).toBeNull();
  });

  it('never answers another bot', () => {
    const fromBot = message({ from: { id: 1, is_bot: true, first_name: 'Other' } });
    expect(telegramChannel.parse(update(fromBot), SETTINGS)).toBeNull();
  });

  it('uses a caption when there is no text', () => {
    const captioned = message({ text: undefined, caption: 'look at this' });
    expect(telegramChannel.parse(update(captioned), SETTINGS)?.text).toBe('look at this');
  });

  it('tells the agent about attachments it cannot open yet', () => {
    const photo = message({ text: undefined, caption: undefined, photo: [{ file_id: 'f1' }] });
    const parsed = telegramChannel.parse(update(photo), SETTINGS);

    expect(parsed?.attachments).toEqual([{ type: 'image', externalId: 'f1' }]);
    expect(parsed?.text).toContain('attachment');
  });

  it('returns null for an update with neither text nor attachments', () => {
    const empty = message({ text: undefined, caption: undefined });
    expect(telegramChannel.parse(update(empty), SETTINGS)).toBeNull();
  });

  it('falls back to chat and message ids when update_id is absent', () => {
    const noUpdateId = { message: message().message };
    expect(telegramChannel.parse(update(noUpdateId), SETTINGS)?.externalMessageId).toBe('-900:5');
  });
});

describe('splitForTelegram', () => {
  it('leaves a short answer untouched', () => {
    expect(splitForTelegram('hello')).toEqual(['hello']);
  });

  it('splits on a paragraph boundary when it can', () => {
    const text = `${'a'.repeat(60)}\n\n${'b'.repeat(60)}`;
    expect(splitForTelegram(text, 100)).toEqual(['a'.repeat(60), 'b'.repeat(60)]);
  });

  it('hard-splits text with no break point', () => {
    const chunks = splitForTelegram('x'.repeat(250), 100);
    expect(chunks).toHaveLength(3);
    expect(chunks.every((c) => c.length <= 100)).toBe(true);
    expect(chunks.join('')).toBe('x'.repeat(250));
  });

  it('keeps every chunk inside Telegram’s 4096-character limit', () => {
    const chunks = splitForTelegram('word '.repeat(3000));
    expect(chunks.every((c) => c.length <= 4096)).toBe(true);
  });
});

describe('telegram config', () => {
  it('requires both the bot token and the webhook secret', () => {
    const result = validateChannelSettings(telegramChannel, {});
    expect(result.ok).toBe(false);
    expect(Object.keys(result.errors).sort()).toEqual(['botToken', 'webhookSecret']);
  });

  it('accepts a complete configuration', () => {
    expect(validateChannelSettings(telegramChannel, SETTINGS)).toEqual({ ok: true, errors: {} });
  });
});

describe('telegram health', () => {
  it('reports misconfigured before any network call when settings are missing', async () => {
    expect(await telegramChannel.health({})).toMatchObject({ status: 'misconfigured' });
    expect(await telegramChannel.health({ botToken: '1:A' })).toMatchObject({
      status: 'misconfigured',
    });
  });
});
