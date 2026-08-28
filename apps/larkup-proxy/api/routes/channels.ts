import {
  createHmac,
  createPublicKey,
  timingSafeEqual,
  verify as verifySignature,
} from 'node:crypto';
import { Hono } from 'hono';
import {
  activateSlackRelay,
  createSlackRelayInstallation,
  deactivateSlackRelay,
  findSlackRelay,
} from '../lib/slack-relay-store.js';
import {
  activateDiscordRelay,
  createDiscordRelayInstallation,
  deactivateDiscordRelay,
  findDiscordRelay,
} from '../lib/discord-relay-store.js';

const STATE_TTL_MS = 10 * 60 * 1000;
const MAX_SIGNATURE_SKEW_MS = 5 * 60 * 1000;
const app = new Hono();

const SLACK_BOT_SCOPES = [
  'chat:write',
  'app_mentions:read',
  'channels:history',
  'groups:history',
  'im:history',
  'im:read',
];
const DISCORD_ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

app.get('/slack/oauth', (c) => {
  const redirectTo = c.req.query('redirect_to');
  if (!redirectTo || !isAllowedCallback(redirectTo, 'slack'))
    return c.text('Unapproved channel OAuth callback URL', 400);

  const { clientId } = slackConnectionCredentials();
  if (!clientId) return c.text('Managed Slack connection is temporarily unavailable.', 503);
  if (!process.env.DATABASE_URL?.trim())
    return c.text('Managed Slack connection relay is temporarily unavailable.', 503);

  const authorizationUrl = new URL('https://slack.com/oauth/v2/authorize');
  authorizationUrl.searchParams.set('client_id', clientId);
  authorizationUrl.searchParams.set('redirect_uri', getProxyCallback(c.req.url, 'slack'));
  authorizationUrl.searchParams.set('scope', SLACK_BOT_SCOPES.join(','));
  authorizationUrl.searchParams.set(
    'state',
    signState({ provider: 'slack', redirectTo, issuedAt: Date.now() }),
  );
  return c.redirect(authorizationUrl.toString());
});

app.get('/slack/oauth/callback', async (c) => {
  const signedState = c.req.query('state');
  const state = signedState ? verifyState(signedState) : undefined;
  if (!state || state.provider !== 'slack' || !isAllowedCallback(state.redirectTo, 'slack'))
    return c.text('Invalid or expired channel OAuth state', 400);

  const providerError = c.req.query('error');
  const code = c.req.query('code');
  if (providerError || !code)
    return redirectResult(state.redirectTo, { error: providerError ?? 'missing_code' });

  const { clientId, clientSecret } = slackConnectionCredentials();
  if (!clientId || !clientSecret) return c.text('Managed Slack connection is unavailable.', 503);

  try {
    const response = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: getProxyCallback(c.req.url, 'slack'),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      access_token?: string;
      team?: { id?: string; name?: string };
    };
    if (!response.ok || !payload.ok || !payload.access_token || !payload.team?.id) {
      console.error(`[larkup-proxy] channel token exchange failed: slack -> ${response.status}`);
      return redirectResult(state.redirectTo, { error: 'token_exchange_failed' });
    }
    const relaySecret = await createSlackRelayInstallation(payload.team.id);
    return redirectResult(state.redirectTo, {
      token: payload.access_token,
      team_id: payload.team.id,
      relay_secret: relaySecret,
      ...(payload.team?.name ? { team: payload.team.name } : {}),
    });
  } catch {
    return redirectResult(state.redirectTo, { error: 'relay_setup_failed' });
  }
});

app.post('/slack/verify', async (c) => {
  const rawBody = await c.req.text();
  const valid = verifySlackSignature(
    rawBody,
    c.req.header('x-slack-request-timestamp'),
    c.req.header('x-slack-signature'),
  );
  return c.json({ valid }, valid ? 200 : 401);
});

app.post('/slack/events', async (c) => {
  const rawBody = await c.req.text();
  if (
    !verifySlackSignature(
      rawBody,
      c.req.header('x-slack-request-timestamp'),
      c.req.header('x-slack-signature'),
    )
  ) {
    return c.text('Invalid Slack signature.', 401);
  }

  const payload = parseSlackPayload(rawBody);
  if (payload?.type === 'url_verification' && typeof payload.challenge === 'string') {
    return c.json({ challenge: payload.challenge });
  }
  if (!payload?.team_id) return c.text('Slack event has no workspace id.', 400);

  try {
    const route = await findSlackRelay(payload.team_id);
    if (!route) return c.text('This Slack workspace has no active Larkup Agent.', 404);
    const endpoint = new URL('/api/connections/slack', route.tunnelUrl);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: forwardedSlackHeaders(c.req.raw.headers),
      body: rawBody,
      signal: AbortSignal.timeout(25_000),
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: { 'Content-Type': response.headers.get('content-type') ?? 'application/json' },
    });
  } catch {
    return c.text('Could not deliver this Slack event to Larkup.', 502);
  }
});

app.post('/slack/relay/register', async (c) => {
  const relaySecret = bearerToken(c.req.header('authorization'));
  const payload = (await c.req.json().catch(() => null)) as {
    workspace_id?: string;
    tunnel_url?: string;
  } | null;
  const tunnelUrl = normalizedPublicTunnelUrl(payload?.tunnel_url);
  if (!relaySecret || !payload?.workspace_id || !tunnelUrl)
    return c.text('Invalid relay registration.', 400);

  try {
    const active = await activateSlackRelay(payload.workspace_id, relaySecret, tunnelUrl);
    return active ? c.json({ ok: true }) : c.text('Unknown Slack installation.', 401);
  } catch {
    return c.text('Could not save the relay route.', 503);
  }
});

app.post('/slack/relay/disconnect', async (c) => {
  const relaySecret = bearerToken(c.req.header('authorization'));
  const payload = (await c.req.json().catch(() => null)) as { workspace_id?: string } | null;
  if (!relaySecret || !payload?.workspace_id) return c.text('Invalid relay disconnect.', 400);
  try {
    const deactivated = await deactivateSlackRelay(payload.workspace_id, relaySecret);
    return deactivated ? c.json({ ok: true }) : c.text('Unknown Slack installation.', 401);
  } catch {
    return c.text('Could not remove the relay route.', 503);
  }
});

app.get('/discord/oauth', (c) => {
  const redirectTo = c.req.query('redirect_to');
  if (!redirectTo || !isAllowedCallback(redirectTo, 'discord'))
    return c.text('Unapproved channel OAuth callback URL', 400);
  const { clientId, clientSecret, publicKey, botToken } = discordConnectionCredentials();
  if (!clientId || !clientSecret || !publicKey || !botToken)
    return c.text('Managed Discord connection is temporarily unavailable.', 503);
  if (!process.env.DATABASE_URL?.trim())
    return c.text('Managed Discord connection relay is temporarily unavailable.', 503);

  const authorizationUrl = new URL('https://discord.com/oauth2/authorize');
  authorizationUrl.searchParams.set('client_id', clientId);
  authorizationUrl.searchParams.set('response_type', 'code');
  authorizationUrl.searchParams.set('redirect_uri', getProxyCallback(c.req.url, 'discord'));
  authorizationUrl.searchParams.set('scope', 'bot applications.commands');
  authorizationUrl.searchParams.set('integration_type', '0');
  authorizationUrl.searchParams.set('prompt', 'consent');
  authorizationUrl.searchParams.set(
    'state',
    signState({ provider: 'discord', redirectTo, issuedAt: Date.now() }),
  );
  return c.redirect(authorizationUrl.toString());
});

app.get('/discord/oauth/callback', async (c) => {
  const signedState = c.req.query('state');
  const state = signedState ? verifyState(signedState) : undefined;
  if (!state || state.provider !== 'discord' || !isAllowedCallback(state.redirectTo, 'discord'))
    return c.text('Invalid or expired channel OAuth state', 400);
  const providerError = c.req.query('error');
  const code = c.req.query('code');
  if (providerError || !code)
    return redirectResult(state.redirectTo, { error: providerError ?? 'missing_code' });

  const { clientId, clientSecret, publicKey, botToken } = discordConnectionCredentials();
  if (!clientId || !clientSecret || !publicKey || !botToken)
    return c.text('Managed Discord connection is unavailable.', 503);

  try {
    const response = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: getProxyCallback(c.req.url, 'discord'),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      guild?: { id?: string; name?: string };
    };
    const guildId = payload.guild?.id ?? c.req.query('guild_id');
    if (!response.ok || !guildId) {
      console.error(`[larkup-proxy] channel token exchange failed: discord -> ${response.status}`);
      return redirectResult(state.redirectTo, { error: 'token_exchange_failed' });
    }
    if (!(await registerDiscordAskCommand(clientId, botToken, guildId)))
      return redirectResult(state.redirectTo, { error: 'command_setup_failed' });
    const relaySecret = await createDiscordRelayInstallation(guildId);
    return redirectResult(state.redirectTo, {
      guild_id: guildId,
      relay_secret: relaySecret,
      application_id: clientId,
      public_key: publicKey,
      ...(payload.guild?.name ? { team: payload.guild.name } : {}),
    });
  } catch {
    return redirectResult(state.redirectTo, { error: 'relay_setup_failed' });
  }
});

app.post('/discord/verify', async (c) => {
  const rawBody = await c.req.text();
  const valid = verifyDiscordSignature(
    rawBody,
    c.req.header('x-signature-timestamp'),
    c.req.header('x-signature-ed25519'),
  );
  return c.json({ valid }, valid ? 200 : 401);
});

app.post('/discord/interactions', async (c) => {
  const rawBody = await c.req.text();
  if (
    !verifyDiscordSignature(
      rawBody,
      c.req.header('x-signature-timestamp'),
      c.req.header('x-signature-ed25519'),
    )
  ) {
    return c.text('Invalid Discord signature.', 401);
  }
  const payload = parseDiscordPayload(rawBody);
  if (payload?.type === 1) return c.json({ type: 1 });
  if (payload?.type !== 2 || !payload.guild_id)
    return c.json({
      type: 4,
      data: { content: 'Use this command in a server connected to Larkup.', flags: 64 },
    });

  try {
    const route = await findDiscordRelay(payload.guild_id);
    if (!route)
      return c.json({
        type: 4,
        data: { content: 'This server is not connected to a Larkup Agent yet.', flags: 64 },
      });
    // Local Larkup acknowledges immediately, then finishes the Agent reply.
    if (!(await forwardDiscordInteraction(route.tunnelUrl, c.req.raw.headers, rawBody))) {
      return c.json({
        type: 4,
        data: { content: 'Larkup could not reach this Agent. Try again shortly.', flags: 64 },
      });
    }
    return c.json({ type: 5 });
  } catch {
    return c.json({
      type: 4,
      data: { content: 'Larkup could not reach this Agent. Try again shortly.', flags: 64 },
    });
  }
});

app.post('/discord/relay/register', async (c) => {
  const relaySecret = bearerToken(c.req.header('authorization'));
  const payload = (await c.req.json().catch(() => null)) as {
    workspace_id?: string;
    tunnel_url?: string;
  } | null;
  const tunnelUrl = normalizedPublicTunnelUrl(payload?.tunnel_url);
  if (!relaySecret || !payload?.workspace_id || !tunnelUrl)
    return c.text('Invalid relay registration.', 400);
  try {
    const active = await activateDiscordRelay(payload.workspace_id, relaySecret, tunnelUrl);
    return active ? c.json({ ok: true }) : c.text('Unknown Discord installation.', 401);
  } catch {
    return c.text('Could not save the relay route.', 503);
  }
});

app.post('/discord/relay/disconnect', async (c) => {
  const relaySecret = bearerToken(c.req.header('authorization'));
  const payload = (await c.req.json().catch(() => null)) as { workspace_id?: string } | null;
  if (!relaySecret || !payload?.workspace_id) return c.text('Invalid relay disconnect.', 400);
  try {
    const deactivated = await deactivateDiscordRelay(payload.workspace_id, relaySecret);
    return deactivated ? c.json({ ok: true }) : c.text('Unknown Discord installation.', 401);
  } catch {
    return c.text('Could not remove the relay route.', 503);
  }
});

function getProxyCallback(requestUrl: string, provider: 'slack' | 'discord'): string {
  return `${new URL(requestUrl).origin}/api/channels/${provider}/oauth/callback`;
}

type ConnectionCredential =
  | 'CLIENT_ID'
  | 'CLIENT_SECRET'
  | 'SIGNING_SECRET'
  | 'PUBLIC_KEY'
  | 'BOT_TOKEN';

function slackConnectionCredentials() {
  return {
    clientId: connectionCredential('slack', 'CLIENT_ID', 'SLACK_CLIENT_ID'),
    clientSecret: connectionCredential('slack', 'CLIENT_SECRET', 'SLACK_CLIENT_SECRET'),
    signingSecret: connectionCredential('slack', 'SIGNING_SECRET', 'SLACK_SIGNING_SECRET'),
  };
}

function discordConnectionCredentials() {
  return {
    clientId: connectionCredential('discord', 'CLIENT_ID'),
    clientSecret: connectionCredential('discord', 'CLIENT_SECRET'),
    publicKey: connectionCredential('discord', 'PUBLIC_KEY'),
    botToken: connectionCredential('discord', 'BOT_TOKEN'),
  };
}

function verifySlackSignature(rawBody: string, timestamp?: string, signature?: string): boolean {
  const { signingSecret } = slackConnectionCredentials();
  if (!signingSecret || !timestamp || !signature) return false;
  const sentAt = Number(timestamp) * 1000;
  if (!Number.isFinite(sentAt) || Math.abs(Date.now() - sentAt) > MAX_SIGNATURE_SKEW_MS)
    return false;
  const expected = `v0=${createHmac('sha256', signingSecret)
    .update(`v0:${timestamp}:${rawBody}`)
    .digest('hex')}`;
  return safeEqual(signature, expected);
}

function parseSlackPayload(
  value: string,
): { type?: string; challenge?: string; team_id?: string } | null {
  try {
    return JSON.parse(value) as { type?: string; challenge?: string; team_id?: string };
  } catch {
    return null;
  }
}

function forwardedSlackHeaders(headers: Headers): Headers {
  const forwarded = new Headers({
    'Content-Type': headers.get('content-type') ?? 'application/json',
  });
  for (const name of ['x-slack-request-timestamp', 'x-slack-signature']) {
    const value = headers.get(name);
    if (value) forwarded.set(name, value);
  }
  return forwarded;
}

function verifyDiscordSignature(rawBody: string, timestamp?: string, signature?: string): boolean {
  const publicKey = discordConnectionCredentials().publicKey?.trim();
  if (!publicKey || !timestamp || !signature) return false;
  if (!/^[0-9a-f]{64}$/i.test(publicKey) || !/^[0-9a-f]{128}$/i.test(signature.trim()))
    return false;
  try {
    const key = createPublicKey({
      key: Buffer.concat([DISCORD_ED25519_SPKI_PREFIX, Buffer.from(publicKey, 'hex')]),
      format: 'der',
      type: 'spki',
    });
    return verifySignature(
      null,
      Buffer.from(`${timestamp}${rawBody}`),
      key,
      Buffer.from(signature.trim(), 'hex'),
    );
  } catch {
    return false;
  }
}

function parseDiscordPayload(value: string): { type?: number; guild_id?: string } | null {
  try {
    return JSON.parse(value) as { type?: number; guild_id?: string };
  } catch {
    return null;
  }
}

async function registerDiscordAskCommand(
  applicationId: string,
  botToken: string,
  guildId: string,
): Promise<boolean> {
  const response = await fetch(
    `https://discord.com/api/v10/applications/${encodeURIComponent(
      applicationId,
    )}/guilds/${encodeURIComponent(guildId)}/commands`,
    {
      method: 'POST',
      headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'ask',
        description: 'Ask this Larkup Agent',
        options: [
          {
            name: 'question',
            description: 'What should Larkup help with?',
            type: 3,
            required: true,
          },
        ],
      }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  return response.ok;
}

async function forwardDiscordInteraction(
  tunnelUrl: string,
  headers: Headers,
  rawBody: string,
): Promise<boolean> {
  try {
    const response = await fetch(new URL('/api/connections/discord', tunnelUrl), {
      method: 'POST',
      headers: forwardedDiscordHeaders(headers),
      body: rawBody,
      signal: AbortSignal.timeout(2_500),
    });
    if (!response.ok) {
      console.error(`[larkup-proxy] Discord relay failed: ${response.status}`);
      return false;
    }
    return true;
  } catch {
    console.error('[larkup-proxy] Discord relay could not reach local tunnel');
    return false;
  }
}

function forwardedDiscordHeaders(headers: Headers): Headers {
  const forwarded = new Headers({
    'Content-Type': headers.get('content-type') ?? 'application/json',
  });
  for (const name of ['x-signature-timestamp', 'x-signature-ed25519']) {
    const value = headers.get(name);
    if (value) forwarded.set(name, value);
  }
  return forwarded;
}

function bearerToken(value?: string): string | undefined {
  const match = /^Bearer ([A-Za-z0-9_-]{32,})$/.exec(value ?? '');
  return match?.[1];
}

function normalizedPublicTunnelUrl(value?: string): string | undefined {
  try {
    const url = new URL(value ?? '');
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      isPrivateAddress(host)
    ) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

function isPrivateAddress(host: string): boolean {
  if (host === '::1' || host.startsWith('127.')) return true;
  if (host.startsWith('10.') || host.startsWith('192.168.')) return true;
  const octets = host.split('.').map(Number);
  return octets.length === 4 && octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31;
}

function connectionCredential(
  providerId: string,
  credential: ConnectionCredential,
  legacyName?: string,
): string | undefined {
  const provider = providerId.toUpperCase().replaceAll(/[^A-Z0-9]/g, '_');
  return (
    process.env[`CONNECTION_${provider}_${credential}`] ??
    (legacyName ? process.env[legacyName] : undefined)
  );
}

function redirectResult(redirectTo: string, parameters: Record<string, string>): Response {
  const url = new URL(redirectTo);
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
  return Response.redirect(url.toString(), 302);
}

function isAllowedCallback(value: string, provider: 'slack' | 'discord'): boolean {
  try {
    const url = new URL(value);
    return (
      allowedOrigins().includes(url.origin) &&
      url.pathname === `/api/connections/${provider}/oauth/callback`
    );
  } catch {
    return false;
  }
}

function allowedOrigins(): string[] {
  return (
    process.env.LARKUP_ALLOWED_REDIRECT_ORIGINS ?? 'http://localhost:4567,http://localhost:3000'
  )
    .split(',')
    .flatMap((origin) => {
      try {
        return [new URL(origin.trim()).origin];
      } catch {
        return [];
      }
    });
}

interface ChannelOAuthState {
  provider: 'slack' | 'discord';
  redirectTo: string;
  issuedAt: number;
}

function signState(state: ChannelOAuthState): string {
  const payload = Buffer.from(JSON.stringify(state)).toString('base64url');
  return `${payload}.${createHmac('sha256', getStateSecret()).update(payload).digest('base64url')}`;
}

function verifyState(value: string): ChannelOAuthState | undefined {
  const [payload, signature] = value.split('.');
  if (!payload || !signature) return undefined;
  const expected = createHmac('sha256', getStateSecret()).update(payload).digest('base64url');
  if (!safeEqual(signature, expected)) return undefined;
  try {
    const state = JSON.parse(Buffer.from(payload, 'base64url').toString()) as ChannelOAuthState;
    return Date.now() - state.issuedAt < STATE_TTL_MS ? state : undefined;
  } catch {
    return undefined;
  }
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function getStateSecret(): string {
  const secret = process.env.OAUTH_STATE_SECRET;
  if (!secret) throw new Error('OAUTH_STATE_SECRET must be configured');
  return secret;
}

export default app;
