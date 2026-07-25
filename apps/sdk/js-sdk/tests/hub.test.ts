import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LarkupHubClient } from '../src/hub';

const fetchMock = vi.fn();
global.fetch = fetchMock;

function ok(body: unknown) {
  return {
    ok: true,
    json: async () => body,
    status: 200,
    statusText: 'OK',
  };
}

describe('LarkupHubClient', () => {
  beforeEach(() => {
    fetchMock.mockClear();
  });

  it('lists tools with filters', async () => {
    fetchMock.mockResolvedValueOnce(ok({ tools: [], total: 0 }));
    const client = new LarkupHubClient({ baseUrl: 'http://hub.local/' });

    const result = await client.listTools({
      category: 'media',
      search: 'video',
      page: 2,
      limit: 10,
    });

    expect(result.total).toBe(0);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://hub.local/v1/tools?category=media&search=video&page=2&limit=10',
    );
  });

  it('gets tool details with an encoded id', async () => {
    fetchMock.mockResolvedValueOnce(
      ok({
        tool: {
          id: 'video/audio',
          name: 'Video',
          description: 'Video tools',
          category: 'media',
          version: '1.0.0',
          pricing: 'free',
          icon: 'Film',
          packageName: '@larkup/video',
          installSize: '1 MB',
          author: 'Larkup',
          capabilities: [],
          downloads: 0,
        },
        installs: 1,
        versions: [],
      }),
    );
    const client = new LarkupHubClient({ baseUrl: 'http://hub.local' });

    const result = await client.getTool('video/audio');

    expect(result.installs).toBe(1);
    expect(fetchMock.mock.calls[0][0]).toBe('http://hub.local/v1/tools/video%2Faudio');
  });
});
