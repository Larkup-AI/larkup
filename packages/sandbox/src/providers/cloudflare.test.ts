import { describe, expect, it, vi, beforeEach } from 'vitest';
import { cloudflareAdapter } from './cloudflare.js';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

describe('cloudflareAdapter.execute', () => {
  it('always fails fast — @cloudflare/sandbox only runs inside a deployed Worker', async () => {
    const result = await cloudflareAdapter.execute({ code: 'print(1)', language: 'python' }, {
      apiToken: 't',
      accountId: 'a',
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Durable Object binding');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('cloudflareAdapter.verifyCredentials', () => {
  it('requires both apiToken and accountId', async () => {
    await expect(cloudflareAdapter.verifyCredentials({ apiToken: 't' })).rejects.toThrow(
      'Cloudflare API token and account ID are both required.',
    );
  });

  it('verifies the token, then confirms account access', async () => {
    (fetch as any).mockResolvedValue({ ok: true });
    await cloudflareAdapter.verifyCredentials({ apiToken: 't', accountId: 'a' });

    expect(fetch).toHaveBeenNthCalledWith(1, 'https://api.cloudflare.com/client/v4/user/tokens/verify', {
      headers: { Authorization: 'Bearer t' },
    });
    expect(fetch).toHaveBeenNthCalledWith(2, 'https://api.cloudflare.com/client/v4/accounts/a', {
      headers: { Authorization: 'Bearer t' },
    });
  });

  it('fails when the token check fails, without checking the account', async () => {
    (fetch as any).mockResolvedValue({ ok: false, status: 401 });
    await expect(cloudflareAdapter.verifyCredentials({ apiToken: 'bad', accountId: 'a' })).rejects.toThrow(
      'rejected the API token',
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('fails when the token works but cannot see the account', async () => {
    (fetch as any)
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, status: 403 });
    await expect(cloudflareAdapter.verifyCredentials({ apiToken: 't', accountId: 'wrong' })).rejects.toThrow(
      'cannot see the given Cloudflare account ID',
    );
  });
});

describe('cloudflareAdapter.healthCheck', () => {
  it('reports status "unsupported" when credentials are valid', async () => {
    (fetch as any).mockResolvedValue({ ok: true });
    const result = await cloudflareAdapter.healthCheck({ apiToken: 't', accountId: 'a' });
    expect(result.status).toBe('unsupported');
  });
});
