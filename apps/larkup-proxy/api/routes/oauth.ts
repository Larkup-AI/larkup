import { createHmac, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { getIntegration } from '@larkup/integrations';
import type { OAuthIntegrationDefinition } from '@larkup/integrations';

const STATE_TTL_MS = 10 * 60 * 1000;
const app = new Hono();

// Atlassian replaces an account's existing grant when the same OAuth client
// receives new consent. Both product flows must therefore request this shared
// read-only scope set or connecting Jira would remove Confluence access (and
// vice versa).
const atlassianReadScopes = [
  'read:jira-work',
  'read:confluence-content.all',
  'read:confluence-space.summary',
  'offline_access',
];

/**
 * Keep OAuth working while the proxy consumes a separately published registry
 * package. The Atlassian entries also preserve the shared-scope rule if that
 * package predates the Jira and Confluence fix.
 */
const proxyOAuthOverrides: Record<string, OAuthIntegrationDefinition> = {
  jira: {
    authorizationUrl: 'https://auth.atlassian.com/authorize',
    tokenUrl: 'https://auth.atlassian.com/oauth/token',
    scopes: atlassianReadScopes,
    clientIdEnv: 'ATLASSIAN_CLIENT_ID',
    clientSecretEnv: 'ATLASSIAN_CLIENT_SECRET',
    accessTokenEnv: 'ATLASSIAN_ACCESS_TOKEN',
    clientAuthentication: 'body',
    authorizationParams: { audience: 'api.atlassian.com', prompt: 'consent' },
  },
  confluence: {
    authorizationUrl: 'https://auth.atlassian.com/authorize',
    tokenUrl: 'https://auth.atlassian.com/oauth/token',
    scopes: atlassianReadScopes,
    clientIdEnv: 'ATLASSIAN_CLIENT_ID',
    clientSecretEnv: 'ATLASSIAN_CLIENT_SECRET',
    accessTokenEnv: 'ATLASSIAN_ACCESS_TOKEN',
    clientAuthentication: 'body',
    authorizationParams: { audience: 'api.atlassian.com', prompt: 'consent' },
  },
  linear: {
    authorizationUrl: 'https://linear.app/oauth/authorize',
    tokenUrl: 'https://api.linear.app/oauth/token',
    scopes: ['read'],
    clientIdEnv: 'LINEAR_CLIENT_ID',
    clientSecretEnv: 'LINEAR_CLIENT_SECRET',
    accessTokenEnv: 'LINEAR_ACCESS_TOKEN',
    clientAuthentication: 'body',
  },
};

/**
 * Centralized OAuth broker for all registry integrations. The app that starts
 * the flow receives the access token at its own callback, so this proxy never
 * stores customer credentials.
 */
app.get('/:integration', (c) => {
  const integrationId = c.req.param('integration');
  const redirectTo = c.req.query('redirect_to');
  const integration = getOAuthIntegration(integrationId);
  if (!integration || !redirectTo) return c.text('Unknown integration or missing redirect_to', 400);
  if (!isAllowedCallback(redirectTo, integrationId))
    return c.text('Unapproved OAuth callback URL', 400);

  const clientId = process.env[integration.oauth.clientIdEnv];
  if (!clientId) return c.text(`${integration.oauth.clientIdEnv} is not configured`, 503);

  const callbackUrl = getProxyCallback(c.req.url, integrationId);
  const authorizationUrl = new URL(integration.oauth.authorizationUrl);
  authorizationUrl.searchParams.set('client_id', clientId);
  authorizationUrl.searchParams.set('redirect_uri', callbackUrl);
  authorizationUrl.searchParams.set('response_type', 'code');
  authorizationUrl.searchParams.set(
    'state',
    signState({ integrationId, redirectTo, issuedAt: Date.now() }),
  );
  if (integration.oauth.scopes.length)
    authorizationUrl.searchParams.set('scope', integration.oauth.scopes.join(' '));
  for (const [key, value] of Object.entries(integration.oauth.authorizationParams ?? {}))
    authorizationUrl.searchParams.set(key, value);
  if (integrationId === 'notion') authorizationUrl.searchParams.set('owner', 'user');
  if (integrationId === 'jira' || integrationId === 'confluence')
    authorizationUrl.searchParams.set('prompt', 'consent');

  return c.redirect(authorizationUrl.toString());
});

app.get('/:integration/callback', async (c) => {
  const integrationId = c.req.param('integration');
  const code = c.req.query('code');
  const signedState = c.req.query('state');
  const oauthError = c.req.query('error');
  if (!getOAuthIntegration(integrationId) || !signedState)
    return c.text('Invalid OAuth callback', 400);

  const state = verifyState(signedState);
  if (
    !state ||
    state.integrationId !== integrationId ||
    !isAllowedCallback(state.redirectTo, integrationId)
  )
    return c.text('Invalid or expired OAuth state', 400);
  if (oauthError || !code)
    return redirectResult(state.redirectTo, { error: oauthError ?? 'missing_code' });

  const integration = getOAuthIntegration(integrationId)!;
  const clientId = process.env[integration.oauth.clientIdEnv];
  const clientSecret = process.env[integration.oauth.clientSecretEnv];
  if (!clientId || !clientSecret)
    return c.text(
      `Missing ${integration.oauth.clientIdEnv} or ${integration.oauth.clientSecretEnv}`,
      503,
    );

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: getProxyCallback(c.req.url, integrationId),
  });
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };
  if (integration.oauth.clientAuthentication === 'basic')
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString(
      'base64',
    )}`;
  else {
    body.set('client_id', clientId);
    body.set('client_secret', clientSecret);
  }

  const response = await fetch(integration.oauth.tokenUrl, { method: 'POST', headers, body });
  if (!response.ok) return redirectResult(state.redirectTo, { error: 'token_exchange_failed' });
  const token = ((await response.json()) as { access_token?: string }).access_token;
  if (!token) return redirectResult(state.redirectTo, { error: 'missing_access_token' });
  return redirectResult(state.redirectTo, { token });
});

function getProxyCallback(requestUrl: string, integrationId: string): string {
  return `${new URL(requestUrl).origin}/api/oauth/${integrationId}/callback`;
}

function getOAuthIntegration(
  integrationId: string,
): { oauth: OAuthIntegrationDefinition } | undefined {
  const oauth = proxyOAuthOverrides[integrationId];
  if (oauth) return { oauth };
  const integration = getIntegration(integrationId);
  if (integration?.status === 'ready') return integration;
  return undefined;
}

function redirectResult(redirectTo: string, parameters: Record<string, string>): Response {
  const url = new URL(redirectTo);
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
  return Response.redirect(url.toString(), 302);
}

function isAllowedCallback(value: string, integrationId: string): boolean {
  try {
    const url = new URL(value);
    const allowedOrigins = (
      process.env.LARKUP_ALLOWED_REDIRECT_ORIGINS ?? 'http://localhost:4567,http://localhost:3000'
    )
      .split(',')
      .map((origin) => {
        try {
          return new URL(origin.trim()).origin;
        } catch {
          return undefined;
        }
      })
      .filter((origin): origin is string => Boolean(origin));
    return (
      allowedOrigins.includes(url.origin) &&
      url.pathname === `/api/integrations/${integrationId}/callback`
    );
  } catch {
    return false;
  }
}

interface OAuthState {
  integrationId: string;
  redirectTo: string;
  issuedAt: number;
}

function signState(state: OAuthState): string {
  const payload = Buffer.from(JSON.stringify(state)).toString('base64url');
  return `${payload}.${createHmac('sha256', getStateSecret()).update(payload).digest('base64url')}`;
}

function verifyState(value: string): OAuthState | undefined {
  const [payload, signature] = value.split('.');
  if (!payload || !signature) return undefined;
  const expected = createHmac('sha256', getStateSecret()).update(payload).digest('base64url');
  if (
    signature.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  )
    return undefined;
  try {
    const state = JSON.parse(Buffer.from(payload, 'base64url').toString()) as OAuthState;
    return Date.now() - state.issuedAt < STATE_TTL_MS ? state : undefined;
  } catch {
    return undefined;
  }
}

function getStateSecret(): string {
  const secret = process.env.OAUTH_STATE_SECRET;
  if (!secret) throw new Error('OAUTH_STATE_SECRET must be configured');
  return secret;
}

export default app;
