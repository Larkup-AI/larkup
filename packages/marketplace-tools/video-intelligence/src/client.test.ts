import { describe, expect, it, vi } from 'vitest';
import { VideoIntelligenceClient } from './client';
import { TOOL_EXTENSION } from './index';

describe('VideoIntelligenceClient', () => {
  it('uses the local endpoint by default and forwards bearer credentials', async () => {
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ status: 'ok', version: '0.1.0', operators: {} })),
    ) as any;
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

  it('uses the same private-loopback default for the Docker-free local runtime', async () => {
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ status: 'ok', version: '0.1.0', operators: {} })),
    ) as any;
    const client = new VideoIntelligenceClient({ mode: 'local-process', fetch: fetcher });

    await client.health();

    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:8787/v1/health', expect.anything());
  });

  it('accepts the managed-cloud health contract used by the control plane', async () => {
    const client = new VideoIntelligenceClient({
      mode: 'managed-cloud',
      endpoint: 'https://video.example.test',
      fetch: vi.fn(async () =>
        Response.json({
          status: 'ok',
          version: '0.1.0',
          runtime: 'managed-cloud',
          processingEnabled: true,
        }),
      ) as any,
    });

    await expect(client.health()).resolves.toMatchObject({ status: 'ok', operators: {} });
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

  it('waits through a temporary GET rate limit instead of abandoning a live job', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: 'slow down' }), {
          status: 429,
          headers: { 'Retry-After': '0' },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          id: 'job_123',
          status: 'running',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:01Z',
          progress: { stage: 'probe', percent: 10, message: 'Working' },
          estimatedSourceMinutes: 1,
          result: null,
          error: null,
        }),
      );
    const client = new VideoIntelligenceClient({
      mode: 'managed-cloud',
      endpoint: 'https://video.example.test',
      fetch: fetcher,
    });

    await expect(client.getJob('job_123')).resolves.toMatchObject({ status: 'running' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('provisions a device-scoped cloud key without sending bearer credentials', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        apiKey: 'lvi_device_key',
        entitlement: {
          plan: 'device',
          sourceMinutesPerMonth: 30,
          maxConcurrentJobs: 1,
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

  it('returns only the user ID for the installed-tool connection display', async () => {
    const provisioned = await TOOL_EXTENSION.provisionRuntime({
      config: {},
      fetch: vi.fn(async () =>
        Response.json({
          apiKey: 'lvi_device_key',
          entitlement: {
            plan: 'device',
            sourceMinutesPerMonth: 30,
            maxConcurrentJobs: 1,
          },
        }),
      ) as any,
    });

    expect(provisioned.display).toEqual({ userId: expect.any(String) });
    expect(provisioned.display).not.toHaveProperty('apiKey');
  });

  it('never provisions the managed Cloud connection for local mode', async () => {
    const fetcher = vi.fn() as any;
    const provisioned = await TOOL_EXTENSION.provisionRuntime({
      config: { runtimeMode: 'local' },
      fetch: fetcher,
    });

    expect(provisioned).toEqual({ config: {} });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('downloads the temporary cloud result before the caller explicitly acknowledges it', async () => {
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
    ]);

    await client.acknowledgeJobResult('job_123');

    expect(requests).toEqual([
      'GET https://video.example.test/v1/jobs/job_123',
      'GET https://signed.example.test/result.json',
      'POST https://video.example.test/v1/jobs/job_123/result/ack',
    ]);
  });

  it('migrates the legacy cloud credential shape away from the old local default', async () => {
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ status: 'ok', version: '0.1.0', operators: {} })),
    ) as any;
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

  it('rejects a healthy-looking endpoint that is not a Video Intelligence runtime', async () => {
    const client = new VideoIntelligenceClient({
      mode: 'local-docker',
      fetch: vi.fn(async () => Response.json({ status: 'ok' })) as any,
    });

    await expect(client.health()).rejects.toThrow(
      'did not identify itself as a Video Intelligence runtime',
    );
  });
});
