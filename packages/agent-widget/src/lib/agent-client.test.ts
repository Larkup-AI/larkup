import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentRequestError, fetchPublicConfig, streamChat } from './agent-client';
import type { WidgetConfig } from '../types';

const config: WidgetConfig = {
  host: 'https://agent.larkup.ai',
  agentId: 'agt_test',
};

function mockResponse(init: { ok: boolean; status: number; body?: unknown }): Response {
  return {
    ok: init.ok,
    status: init.status,
    json: async () => init.body ?? {},
    body: null,
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchPublicConfig error mapping', () => {
  it('explains a 403 in terms of the calling page, not a raw status code', async () => {
    vi.stubGlobal('location', { origin: 'https://stranger-site.com' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse({ ok: false, status: 403 })));

    await expect(fetchPublicConfig(config)).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining('stranger-site.com'),
    });
  });

  it('maps a 404 to a "not found" message naming the agent', async () => {
    vi.stubGlobal('location', { origin: 'https://ok-site.com' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse({ ok: false, status: 404 })));

    await expect(fetchPublicConfig(config)).rejects.toMatchObject({
      status: 404,
      message: expect.stringContaining('agt_test'),
    });
  });

  it('turns an opaque network rejection into an actionable message', async () => {
    vi.stubGlobal('location', { origin: 'https://ok-site.com' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(fetchPublicConfig(config)).rejects.toMatchObject({
      status: 0,
      message: expect.stringContaining(config.host),
    });
  });
});

describe('streamChat error mapping (plan §8.5)', () => {
  it('maps 429 to the fixed widget-facing rate-limit message regardless of which limit tripped', async () => {
    vi.stubGlobal('location', { origin: 'https://ok-site.com' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse({ ok: false, status: 429 })));

    await expect(
      streamChat({ config, messages: [{ role: 'user', content: 'hi' }], onUpdate: () => {} }),
    ).rejects.toMatchObject({
      status: 429,
      message: 'Too many messages — try again in a minute.',
    });
  });

  it('still distinguishes 403 (origin) from 429 (rate limit) rather than collapsing all errors', async () => {
    vi.stubGlobal('location', { origin: 'https://ok-site.com' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse({ ok: false, status: 403 })));

    await expect(
      streamChat({ config, messages: [{ role: 'user', content: 'hi' }], onUpdate: () => {} }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('maps 409 to a publish-a-release message', async () => {
    vi.stubGlobal('location', { origin: 'https://ok-site.com' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse({ ok: false, status: 409 })));

    await expect(
      streamChat({ config, messages: [{ role: 'user', content: 'hi' }], onUpdate: () => {} }),
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('Publish'),
    });
  });

  it('falls back to the server-provided error message for an unmapped status', async () => {
    vi.stubGlobal('location', { origin: 'https://ok-site.com' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(mockResponse({ ok: false, status: 500, body: { error: 'boom' } })),
    );

    await expect(
      streamChat({ config, messages: [{ role: 'user', content: 'hi' }], onUpdate: () => {} }),
    ).rejects.toBeInstanceOf(AgentRequestError);
  });
});
