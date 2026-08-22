import { describe, expect, it, vi } from 'vitest';
import { VideoIntelligenceClient } from './client';
import { TOOL_EXTENSION } from './index';

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

  it('provisions a device-scoped cloud key without sending bearer credentials', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        apiKey: 'lvi_device_key',
        entitlement: {
          plan: 'device',
          sourceMinutesPerMonth: 30,
          maxConcurrentJobs: 1,
          allowFullCoverage: false,
        },
      }),
    ) as any;
    const client = new VideoIntelligenceClient({
      mode: 'managed-cloud',
      endpoint: 'https://video.example.test',
      apiKey: 'existing-key-must-not-be-sent',
      fetch: fetcher,
    });

    const connection = await client.provisionDeviceAccess('550e8400-e29b-41d4-a716-446655440000');

    expect(connection.entitlement.plan).toBe('device');
    expect(fetcher).toHaveBeenCalledWith(
      'https://video.example.test/v1/device-keys',
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
    const headers = fetcher.mock.calls[0][1].headers as Headers;
    expect(headers.get('authorization')).toBeNull();
  });

  it('acknowledges the temporary cloud result only after it is downloaded', async () => {
    const requests: string[] = [];
    const client = new VideoIntelligenceClient({
      mode: 'managed-cloud',
      endpoint: 'https://video.example.test',
      apiKey: 'test-key',
      fetch: async (input, init) => {
        const url = String(input);
        requests.push(`${init?.method ?? 'GET'} ${url}`);
        if (url === 'https://video.example.test/v1/jobs/job_123') {
          return Response.json({
            id: 'job_123',
            status: 'completed',
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            progress: { stage: 'complete', percent: 100, message: 'Index ready' },
            estimatedSourceMinutes: 1,
            result: null,
            resultUrl: 'https://signed.example.test/result.json',
            error: null,
          });
        }
        if (url === 'https://signed.example.test/result.json') {
          return Response.json({ schemaVersion: 1, jobId: 'job_123' });
        }
        return Response.json({ status: 'acknowledged' });
      },
    });

    const job = await client.getJob('job_123');

    expect(job.result).toMatchObject({ jobId: 'job_123' });
    expect(requests).toEqual([
      'GET https://video.example.test/v1/jobs/job_123',
      'GET https://signed.example.test/result.json',
      'POST https://video.example.test/v1/jobs/job_123/result/ack',
    ]);
  });

  it('migrates the legacy cloud credential shape away from the old local default', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ status: 'ok' }))) as any;
    const client = TOOL_EXTENSION.createClient({
      config: { runtimeMode: 'local-docker', cloudApiKey: 'legacy-cloud-key' },
      fetch: fetcher,
    });

    await client.health();

    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining('/v1/health'),
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
    const headers = fetcher.mock.calls[0][1].headers as Headers;
    expect(headers.get('authorization')).toBe('Bearer legacy-cloud-key');
    expect(fetcher.mock.calls[0][0]).not.toContain('127.0.0.1');
  });
});
