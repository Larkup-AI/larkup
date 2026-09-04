import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getInstalledTool: vi.fn(),
  loadToolExtension: vi.fn(),
}));

vi.mock('@larkup/core/config-store', () => ({ readConfig: vi.fn() }));
vi.mock('@larkup/core/project-store', () => ({
  runWithProject: vi.fn((_projectId, operation) => operation()),
}));
vi.mock('@larkup/marketplace/extension', () => ({
  loadToolExtension: mocks.loadToolExtension,
}));
vi.mock('@larkup/marketplace/installer', () => ({
  getInstalledTool: mocks.getInstalledTool,
}));
vi.mock('@/lib/marketplace/tool-runtime-config', () => ({
  withGlobalVisionGatewayConfig: vi.fn((config) => config),
}));

import { POST } from './route';

const context = { params: Promise.resolve({ toolId: 'video-intelligence' }) };

beforeEach(() => {
  mocks.getInstalledTool.mockReset();
  mocks.loadToolExtension.mockReset();
  mocks.getInstalledTool.mockResolvedValue({ id: 'video-intelligence', config: {} });
});

describe('tool verification route', () => {
  it('reports a runtime loading failure separately from unsupported verification', async () => {
    mocks.loadToolExtension.mockResolvedValue(null);

    const response = await POST(
      new Request('http://localhost/api/tools/video-intelligence/verify', {
        method: 'POST',
        body: '{}',
      }),
      context,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'Installed tool could not be loaded. Restart Larkup or reinstall the tool.',
    });
  });

  it('reports unsupported verification only for a successfully loaded extension', async () => {
    mocks.loadToolExtension.mockResolvedValue({ createClient: vi.fn() });

    const response = await POST(
      new Request('http://localhost/api/tools/video-intelligence/verify', {
        method: 'POST',
        body: '{}',
      }),
      context,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'This tool does not support verification.',
    });
  });
});
