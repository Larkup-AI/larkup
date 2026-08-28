import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { discordChannel, discordInteractionResponse, discordPingResponse } from './discord';
import type { InboundRequest } from '../types';

const keys = generateKeyPairSync('ed25519');
const publicKey = keys.publicKey
  .export({ format: 'der', type: 'spki' })
  .subarray(-32)
  .toString('hex');

function request(payload: unknown): InboundRequest {
  const rawBody = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const signature = sign(null, Buffer.from(`${timestamp}${rawBody}`), keys.privateKey).toString(
    'hex',
  );
  return {
    method: 'POST',
    headers: {
      'x-signature-timestamp': timestamp,
      'x-signature-ed25519': signature,
    },
    rawBody,
    body: payload,
    query: {},
  };
}

describe('discord channel', () => {
  it('verifies Discord’s Ed25519 request signature', () => {
    expect(discordChannel.verify(request({ type: 1 }), { publicKey })).toEqual({ ok: true });
  });

  it('fails closed when a body is modified after signing', () => {
    const inbound = request({ type: 1 });
    inbound.rawBody = JSON.stringify({ type: 2 });
    expect(discordChannel.verify(inbound, { publicKey })).toMatchObject({ ok: false, status: 401 });
  });

  it('normalizes a slash command', () => {
    const inbound = request({
      id: 'interaction-1',
      application_id: 'application-1',
      type: 2,
      channel_id: 'channel-1',
      token: 'interaction-token',
      member: { user: { id: 'user-1', username: 'Ada', global_name: 'Ada Lovelace' } },
      data: { name: 'ask', options: [{ name: 'question', value: 'What changed today?' }] },
    });
    expect(discordChannel.parse(inbound, { publicKey })).toMatchObject({
      externalMessageId: 'interaction-1',
      conversationId: 'channel-1',
      endUserId: 'user-1',
      endUserName: 'Ada Lovelace',
      text: 'ask What changed today?',
      replyContext: {
        interactionId: 'interaction-1',
        applicationId: 'application-1',
        interactionToken: 'interaction-token',
      },
    });
  });

  it('returns the required ping and response payload shapes', () => {
    expect(discordPingResponse({ type: 1 })).toEqual({ type: 1 });
    expect(discordPingResponse({ type: 2 })).toBeNull();
    expect(discordInteractionResponse('hello')).toEqual({ type: 4, data: { content: 'hello' } });
  });

  it('declares the ping response on the adapter for the generic inbound route', () => {
    expect(discordChannel.interceptInbound?.(request({ type: 1 }))).toEqual({ body: { type: 1 } });
    expect(discordChannel.interceptInbound?.(request({ type: 2 }))).toEqual({
      body: { type: 5 },
      dispatch: true,
    });
  });

  it('does not ask managed OAuth users to configure a Discord webhook', async () => {
    await expect(
      discordChannel.health({
        publicKey,
        guildId: '123456789012345678',
        relaySecret: 'relay-secret',
      }),
    ).resolves.toMatchObject({
      status: 'ok',
      detail: 'Discord is securely connected through Larkup Proxy.',
      testUrl: 'https://discord.com/channels/123456789012345678',
      testUrlLabel: 'Open Discord server',
    });
  });

  it('edits the deferred interaction reply without a bot token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      discordChannel.send(
        {
          conversationId: 'channel-1',
          text: 'A complete answer',
          replyContext: { applicationId: 'application-1', interactionToken: 'interaction-token' },
        },
        { publicKey },
      ),
    ).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://discord.com/api/v10/webhooks/application-1/interaction-token/messages/@original',
      expect.objectContaining({ method: 'PATCH' }),
    );
    vi.unstubAllGlobals();
  });
});
