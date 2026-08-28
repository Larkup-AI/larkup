import { createHmac, generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const relayStore = vi.hoisted(() => ({
  createSlackRelayInstallation: vi.fn(),
  activateSlackRelay: vi.fn(),
  deactivateSlackRelay: vi.fn(),
  findSlackRelay: vi.fn(),
}));

vi.mock('../lib/slack-relay-store.js', () => relayStore);

const discordRelayStore = vi.hoisted(() => ({
  createDiscordRelayInstallation: vi.fn(),
  activateDiscordRelay: vi.fn(),
  deactivateDiscordRelay: vi.fn(),
  findDiscordRelay: vi.fn(),
}));

vi.mock('../lib/discord-relay-store.js', () => discordRelayStore);

const discordKeys = generateKeyPairSync('ed25519');
const DISCORD_PUBLIC_KEY = discordKeys.publicKey
  .export({ format: 'der', type: 'spki' })
  .subarray(-32)
  .toString('hex');

const ENV = {
  OAUTH_STATE_SECRET: 'test-state-secret-not-a-real-one',
  LARKUP_ALLOWED_REDIRECT_ORIGINS: 'https://app.example.com',
  SLACK_CLIENT_ID: 'slack-client-id',
  SLACK_CLIENT_SECRET: 'slack-client-secret',
  SLACK_SIGNING_SECRET: 'slack-signing-secret',
  DATABASE_URL: 'postgres://relay-test.invalid/larkup',
  CONNECTION_DISCORD_CLIENT_ID: 'discord-application-id',
  CONNECTION_DISCORD_CLIENT_SECRET: 'discord-client-secret',
  CONNECTION_DISCORD_PUBLIC_KEY: DISCORD_PUBLIC_KEY,
  CONNECTION_DISCORD_BOT_TOKEN: 'discord-bot-token',
};
const CONNECTION_ENV = {
  CONNECTION_SLACK_CLIENT_ID: 'connection-slack-client-id',
  CONNECTION_SLACK_CLIENT_SECRET: 'connection-slack-client-secret',
  CONNECTION_SLACK_SIGNING_SECRET: 'connection-slack-signing-secret',
};
const CALLBACK = 'https://app.example.com/api/connections/slack/oauth/callback';
const DISCORD_CALLBACK = 'https://app.example.com/api/connections/discord/oauth/callback';

let app: typeof import('../index.js').default;

beforeEach(async () => {
  vi.resetModules();
  relayStore.createSlackRelayInstallation.mockResolvedValue('relay-secret-for-test-only');
  relayStore.activateSlackRelay.mockResolvedValue(true);
  relayStore.deactivateSlackRelay.mockResolvedValue(true);
  relayStore.findSlackRelay.mockResolvedValue(undefined);
  discordRelayStore.createDiscordRelayInstallation.mockResolvedValue('discord-relay-secret');
  discordRelayStore.activateDiscordRelay.mockResolvedValue(true);
  discordRelayStore.deactivateDiscordRelay.mockResolvedValue(true);
  discordRelayStore.findDiscordRelay.mockResolvedValue(undefined);
  for (const [key, value] of Object.entries(ENV)) process.env[key] = value;
  ({ default: app } = await import('../index.js'));
});

afterEach(() => {
  for (const key of [...Object.keys(ENV), ...Object.keys(CONNECTION_ENV)]) delete process.env[key];
  vi.unstubAllGlobals();
});

function start() {
  return app.request(`/api/channels/slack/oauth?redirect_to=${encodeURIComponent(CALLBACK)}`);
}

describe('managed Slack channel OAuth', () => {
  it('starts a bot-scope OAuth flow and only permits the channel callback', async () => {
    const res = await start();
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location')!);
    expect(location.origin).toBe('https://slack.com');
    expect(location.searchParams.get('redirect_uri')).toBe(
      'http://localhost/api/channels/slack/oauth/callback',
    );
    expect(location.searchParams.get('scope')).toContain('chat:write');

    const rejected = await app.request(
      '/api/channels/slack/oauth?redirect_to=https%3A%2F%2Fapp.example.com%2Fapi%2Fintegrations%2Fslack%2Fcallback',
    );
    expect(rejected.status).toBe(400);
  });

  it('prefers connection-scoped credentials over the knowledge integration credentials', async () => {
    Object.assign(process.env, CONNECTION_ENV);
    const res = await start();
    const location = new URL(res.headers.get('location')!);
    expect(location.searchParams.get('client_id')).toBe(CONNECTION_ENV.CONNECTION_SLACK_CLIENT_ID);
  });

  it('exchanges the authorization code and redirects only to the approved local callback', async () => {
    const started = await start();
    const state = new URL(started.headers.get('location')!).searchParams.get('state')!;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: true,
            access_token: 'xoxb-managed',
            team: { id: 'T123', name: 'Acme' },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      ),
    );

    const res = await app.request(
      `/api/channels/slack/oauth/callback?code=code&state=${encodeURIComponent(state)}`,
    );
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location')!);
    expect(location.origin + location.pathname).toBe(CALLBACK);
    expect(location.searchParams.get('token')).toBe('xoxb-managed');
    expect(location.searchParams.get('team')).toBe('Acme');
    expect(location.searchParams.get('team_id')).toBe('T123');
    expect(location.searchParams.get('relay_secret')).toBe('relay-secret-for-test-only');
    expect(relayStore.createSlackRelayInstallation).toHaveBeenCalledWith('T123');
  });
});

describe('managed Slack relay', () => {
  function slackHeaders(body: string) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    return {
      'Content-Type': 'application/json',
      'X-Slack-Request-Timestamp': timestamp,
      'X-Slack-Signature': `v0=${createHmac('sha256', ENV.SLACK_SIGNING_SECRET)
        .update(`v0:${timestamp}:${body}`)
        .digest('hex')}`,
    };
  }

  it('accepts Slack URL verification without requiring a local agent to be online', async () => {
    const body = JSON.stringify({ type: 'url_verification', challenge: 'challenge-value' });
    const response = await app.request('/api/channels/slack/events', {
      method: 'POST',
      headers: slackHeaders(body),
      body,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ challenge: 'challenge-value' });
  });

  it('forwards a verified workspace event to that workspace local tunnel only', async () => {
    relayStore.findSlackRelay.mockResolvedValue({
      teamId: 'T123',
      tunnelUrl: 'https://example-tunnel.ngrok.app',
    });
    const forwarded = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', forwarded);
    const body = JSON.stringify({
      type: 'event_callback',
      team_id: 'T123',
      event: { type: 'app_mention' },
    });
    const response = await app.request('/api/channels/slack/events', {
      method: 'POST',
      headers: slackHeaders(body),
      body,
    });
    expect(response.status).toBe(200);
    expect(forwarded).toHaveBeenCalledWith(
      new URL('/api/connections/slack', 'https://example-tunnel.ngrok.app'),
      expect.objectContaining({ body, method: 'POST' }),
    );
  });
});

describe('managed Slack signature verification', () => {
  it('accepts only a current Slack signature for the exact forwarded bytes', async () => {
    const body = '{"type":"url_verification"}';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = `v0=${createHmac('sha256', ENV.SLACK_SIGNING_SECRET)
      .update(`v0:${timestamp}:${body}`)
      .digest('hex')}`;
    const verified = await app.request('/api/channels/slack/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Slack-Request-Timestamp': timestamp,
        'X-Slack-Signature': signature,
      },
      body,
    });
    expect(verified.status).toBe(200);
    expect(await verified.json()).toEqual({ valid: true });

    const rejected = await app.request('/api/channels/slack/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Slack-Request-Timestamp': timestamp,
        'X-Slack-Signature': 'v0=invalid',
      },
      body,
    });
    expect(rejected.status).toBe(401);
  });
});

function discordHeaders(body: string) {
  const timestamp = String(Date.now());
  return {
    'Content-Type': 'application/json',
    'X-Signature-Timestamp': timestamp,
    'X-Signature-Ed25519': sign(
      null,
      Buffer.from(`${timestamp}${body}`),
      discordKeys.privateKey,
    ).toString('hex'),
  };
}

describe('managed Discord channel OAuth', () => {
  function startDiscord() {
    return app.request(
      `/api/channels/discord/oauth?redirect_to=${encodeURIComponent(DISCORD_CALLBACK)}`,
    );
  }

  it('starts a scoped OAuth flow for a selected Discord server', async () => {
    const response = await startDiscord();
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location')!);
    expect(location.origin).toBe('https://discord.com');
    expect(location.searchParams.get('scope')).toBe('bot applications.commands');
    expect(location.searchParams.get('redirect_uri')).toBe(
      'http://localhost/api/channels/discord/oauth/callback',
    );
  });

  it('exchanges the grant, creates /ask for that server, and returns only relay fields', async () => {
    const started = await startDiscord();
    const state = new URL(started.headers.get('location')!).searchParams.get('state')!;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ guild: { id: 'G123', name: 'Acme server' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await app.request(
      `/api/channels/discord/oauth/callback?code=code&state=${encodeURIComponent(state)}`,
    );
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location')!);
    expect(location.origin + location.pathname).toBe(DISCORD_CALLBACK);
    expect(location.searchParams.get('guild_id')).toBe('G123');
    expect(location.searchParams.get('relay_secret')).toBe('discord-relay-secret');
    expect(location.searchParams.get('public_key')).toBe(DISCORD_PUBLIC_KEY);
    expect(discordRelayStore.createDiscordRelayInstallation).toHaveBeenCalledWith('G123');
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://discord.com/api/v10/applications/discord-application-id/guilds/G123/commands',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

describe('managed Discord interactions', () => {
  it('answers the signed Discord ping before a local Agent exists', async () => {
    const body = JSON.stringify({ type: 1 });
    const response = await app.request('/api/channels/discord/interactions', {
      method: 'POST',
      headers: discordHeaders(body),
      body,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ type: 1 });
  });

  it('returns an immediate deferred response and forwards the signed command to its server tunnel', async () => {
    discordRelayStore.findDiscordRelay.mockResolvedValue({
      guildId: 'G123',
      tunnelUrl: 'https://example-tunnel.ngrok.app',
    });
    const forwarded = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', forwarded);
    const body = JSON.stringify({ type: 2, id: 'I1', guild_id: 'G123', token: 'token' });
    const response = await app.request('/api/channels/discord/interactions', {
      method: 'POST',
      headers: discordHeaders(body),
      body,
    });
    expect(await response.json()).toEqual({ type: 5 });
    expect(forwarded).toHaveBeenCalledWith(
      new URL('/api/connections/discord', 'https://example-tunnel.ngrok.app'),
      expect.objectContaining({ method: 'POST', body }),
    );
  });
});
