import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  compareToolVersions: vi.fn((available: string, installed: string) =>
    available.localeCompare(installed, undefined, { numeric: true }),
  ),
  getAllTools: vi.fn(),
  getDownloadCounts: vi.fn(),
  getInstalledTools: vi.fn(),
  getOngoingOperations: vi.fn(),
  resolveWorkspaceToolPath: vi.fn(),
}));

vi.mock('@larkup/marketplace/registry', () => ({
  compareToolVersions: mocks.compareToolVersions,
  getAllTools: mocks.getAllTools,
}));
vi.mock('@larkup/marketplace/installer', () => ({
  getDownloadCounts: mocks.getDownloadCounts,
  getInstalledTools: mocks.getInstalledTools,
  getOngoingOperations: mocks.getOngoingOperations,
  resolveWorkspaceToolPath: mocks.resolveWorkspaceToolPath,
}));

import { GET } from './route';

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.compareToolVersions.mockImplementation((available: string, installed: string) =>
    available.localeCompare(installed, undefined, { numeric: true }),
  );
  mocks.getAllTools.mockResolvedValue([
    {
      id: 'video-intelligence',
      name: 'Video Intelligence',
      version: '0.2.9',
      downloads: 0,
    },
  ]);
  mocks.getInstalledTools.mockResolvedValue([
    {
      id: 'video-intelligence',
      version: '0.2.8',
      source: 'registry',
      packageName: '@larkup/tool-video-intelligence',
      config: {},
      installedAt: '2026-09-13T00:00:00.000Z',
    },
  ]);
  mocks.getDownloadCounts.mockResolvedValue({});
  mocks.getOngoingOperations.mockReturnValue({ installing: [], uninstalling: [] });
});

describe('marketplace catalog route', () => {
  it('reports an installed tool separately from the newest catalog version', async () => {
    const response = await GET();
    const body = (await response.json()) as { tools: Array<Record<string, unknown>> };

    expect(body.tools[0]).toMatchObject({
      status: 'installed',
      installedVersion: '0.2.8',
      availableVersion: '0.2.9',
      updateAvailable: true,
    });
  });
});
