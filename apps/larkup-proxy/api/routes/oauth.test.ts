import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Contract tests for the Knowledge Integration OAuth Proxy
 */

const ENV = {
  OAUTH_STATE_SECRET: 'test-state-secret-not-a-real-one',
  LARKUP_ALLOWED_REDIRECT_ORIGINS: 'https://app.example.com',
  NOTION_CLIENT_ID: 'notion-client-id',
  NOTION_CLIENT_SECRET: 'notion-client-secret',
};

const ALLOWED_REDIRECT = 'https://app.example.com/api/integrations/notion/callback';
const DISALLOWED_REDIRECT = 'https://evil.example.com/api/integrations/notion/callback';
const WRONG_PATH_REDIRECT = 'https://app.example.com/some/other/path';

let app: typeof import('../index.js').default;

beforeEach(async () => {
  vi.resetModules();
  for (const [key, value] of Object.entries(ENV)) process.env[key] = value;
  ({ default: app } = await import('../index.js'));
});

afterEach(() => {
  for (const key of Object.keys(ENV)) delete process.env[key];
  delete process.env.JIRA_CLIENT_ID; // in case a test sets it
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function startFlow(integration: string, redirectTo: string) {
  return app.request(`/api/oauth/${integration}?redirect_to=${encodeURIComponent(redirectTo)}`);
}

async function stateFromRedirect(res: Response): Promise<string> {
  const location = res.headers.get('location');
  expect(location).toBeTruthy();
  return new URL(location!).searchParams.get('state')!;
}

describe('GET /api/oauth/:integration — starting the flow', () => {
  it('redirects to the provider with a signed state and the registry scopes', async () => {
    const res = await startFlow('notion', ALLOWED_REDIRECT);
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location')!);
    expect(location.origin).toBe('https://api.notion.com');
    expect(location.searchParams.get('client_id')).toBe('notion-client-id');
    expect(location.searchParams.get('state')).toBeTruthy();
  });

  it('400s an unknown integration', async () => {
    const res = await startFlow('not-a-real-provider', ALLOWED_REDIRECT);
    expect(res.status).toBe(400);
  });

  it('400s when redirect_to is missing', async () => {
    const res = await app.request('/api/oauth/notion');
    expect(res.status).toBe(400);
  });

  it('400s a redirect_to whose origin is not allow-listed — the core redirect-origin policy', async () => {
    const res = await startFlow('notion', DISALLOWED_REDIRECT);
    expect(res.status).toBe(400);
  });

  it('400s a redirect_to on an allowed origin but the wrong path', async () => {
    // An attacker who controls a different path on an otherwise-allowed
    // origin must not be able to redirect the token there.
    const res = await startFlow('notion', WRONG_PATH_REDIRECT);
    expect(res.status).toBe(400);
  });

  it('503s when the provider credential env var is not configured', async () => {
    delete process.env.NOTION_CLIENT_ID;
    const res = await startFlow('notion', ALLOWED_REDIRECT);
    expect(res.status).toBe(503);
  });
});

describe('GET /api/oauth/:integration/callback — completing the flow', () => {
  it('400s when state is missing', async () => {
    const res = await app.request('/api/oauth/notion/callback?code=abc123');
    expect(res.status).toBe(400);
  });

  it('400s a tampered state signature', async () => {
    const started = await startFlow('notion', ALLOWED_REDIRECT);
    const state = await stateFromRedirect(started);
    const tampered = state.slice(0, -1) + (state.at(-1) === 'a' ? 'b' : 'a');
    const res = await app.request(
      `/api/oauth/notion/callback?code=abc123&state=${encodeURIComponent(tampered)}`,
    );
    expect(res.status).toBe(400);
  });

  it('400s an expired state — the 10-minute TTL is enforced server-side, not trusted from the client', async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 0, 1) });
    const started = await startFlow('notion', ALLOWED_REDIRECT);
    const state = await stateFromRedirect(started);

    vi.setSystemTime(Date.UTC(2026, 0, 1, 0, 11)); // 11 minutes later
    const res = await app.request(
      `/api/oauth/notion/callback?code=abc123&state=${encodeURIComponent(state)}`,
    );
    expect(res.status).toBe(400);
  });

  it('400s when the state names a different integration than the callback path', async () => {
    const started = await startFlow('notion', ALLOWED_REDIRECT);
    const state = await stateFromRedirect(started);
    // github is also a registered, ready integration — a valid state signed
    // for a different provider must not be accepted here.
    const res = await app.request(
      `/api/oauth/github/callback?code=abc123&state=${encodeURIComponent(state)}`,
    );
    expect(res.status).toBe(400);
  });

  it('redirects back with a denied-consent error rather than failing server-side', async () => {
    const started = await startFlow('notion', ALLOWED_REDIRECT);
    const state = await stateFromRedirect(started);
    const res = await app.request(
      `/api/oauth/notion/callback?error=access_denied&state=${encodeURIComponent(state)}`,
    );
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location')!);
    expect(location.origin + location.pathname).toBe(ALLOWED_REDIRECT);
    expect(location.searchParams.get('error')).toBe('access_denied');
  });

  it('exchanges a valid code for a token and hands it back at the caller-supplied redirect only', async () => {
    const started = await startFlow('notion', ALLOWED_REDIRECT);
    const state = await stateFromRedirect(started);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ access_token: 'super-secret-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const res = await app.request(
      `/api/oauth/notion/callback?code=abc123&state=${encodeURIComponent(state)}`,
    );
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location')!);
    expect(location.origin + location.pathname).toBe(ALLOWED_REDIRECT);
    expect(location.searchParams.get('token')).toBe('super-secret-token');
  });

  it('redirects with an error, never the raw provider response, when the token exchange fails', async () => {
    const started = await startFlow('notion', ALLOWED_REDIRECT);
    const state = await stateFromRedirect(started);

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('client_secret=notion-client-secret&error=invalid_grant', { status: 400 }),
        ),
    );

    const res = await app.request(
      `/api/oauth/notion/callback?code=abc123&state=${encodeURIComponent(state)}`,
    );
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location')!);
    expect(location.searchParams.get('error')).toBe('token_exchange_failed');
    // The provider's raw body (which could echo the client secret) must
    // never appear anywhere in the response the browser receives.
    expect(location.toString()).not.toContain('notion-client-secret');
  });
});

describe('GET /api/health', () => {
  it('reports service identity', async () => {
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', service: 'larkup-proxy' });
  });
});
