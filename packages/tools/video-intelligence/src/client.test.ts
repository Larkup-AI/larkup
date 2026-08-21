import { describe, expect, it, vi } from 'vitest';
import { VideoIntelligenceClient } from './client';

describe('VideoIntelligenceClient', () => {
  it('uses the local endpoint by default and forwards bearer credentials', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ status: 'ok' }))) as any;
    const client = new VideoIntelligenceClient({
      mode: 'local-docker',
      apiKey: 'secret',
      fetch: fetcher,
    });
    await client.health();
    expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1:8787/v1/health',
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
    const headers = fetcher.mock.calls[0][1].headers as Headers;
    expect(headers.get('authorization')).toBe('Bearer secret');
  });

  it('surfaces API details on failed requests', async () => {
    const client = new VideoIntelligenceClient({
      mode: 'managed-cloud',
      endpoint: 'https://video.example.test',
      fetch: vi.fn(
        async () => new Response(JSON.stringify({ detail: 'quota reached' }), { status: 429 }),
      ) as any,
    });
    await expect(client.getUsage()).rejects.toThrow('quota reached');
  });
});
