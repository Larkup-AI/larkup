import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getInstalledTool: vi.fn(),
  getToolById: vi.fn(),
  loadToolExtension: vi.fn(),
  readConfig: vi.fn(),
  unloadTool: vi.fn(),
  uninstallTool: vi.fn(),
  writeConfig: vi.fn(),
}));

vi.mock('@larkup/marketplace/registry', () => ({ getToolById: mocks.getToolById }));
vi.mock('@larkup/marketplace/installer', () => ({
  getInstalledTool: mocks.getInstalledTool,
  installTool: vi.fn(),
  isToolInstalled: vi.fn(),
  uninstallTool: mocks.uninstallTool,
}));
vi.mock('@larkup/marketplace/loader', () => ({ unloadTool: mocks.unloadTool }));
vi.mock('@larkup/marketplace/extension', () => ({ loadToolExtension: mocks.loadToolExtension }));
vi.mock('@larkup/core/config-store', () => ({
  readConfig: mocks.readConfig,
  writeConfig: mocks.writeConfig,
}));
vi.mock('@larkup/core/project-store', () => ({
  runWithProject: vi.fn((_projectId, operation) => operation()),
}));

import { DELETE } from './route';

const context = { params: Promise.resolve({ toolId: 'video-intelligence' }) };
const deviceConfig = {
  enabledTools: ['video-intelligence', 'another-tool'],
  toolConfigs: {
    'video-intelligence': {
      cloudInstallationId: 'af87929d-6b47-4fd5-9e09-a95d3b68d701',
      cloudAccessKey: 'lvi_device_key',
    },
    'another-tool': { enabled: true },
  },
};

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getInstalledTool.mockResolvedValue({ id: 'video-intelligence', config: {} });
  mocks.loadToolExtension.mockResolvedValue({});
  mocks.readConfig.mockResolvedValue(deviceConfig);
  mocks.uninstallTool.mockResolvedValue(undefined);
  mocks.writeConfig.mockResolvedValue(undefined);
});

describe('Video Intelligence uninstall', () => {
  it('keeps the device-scoped cloud identity by default', async () => {
    const response = await DELETE(
      new Request('http://localhost/api/marketplace/video-intelligence', { method: 'DELETE' }),
      context,
    );

    expect(await response.json()).toMatchObject({ status: 'uninstalled', configPurged: false });
    expect(mocks.uninstallTool).toHaveBeenCalledWith('video-intelligence');
    expect(mocks.writeConfig).toHaveBeenCalledWith({
      ...deviceConfig,
      enabledTools: ['another-tool'],
    });
  });

  it('only removes the device identity when an explicit purge is requested', async () => {
    const response = await DELETE(
      new Request('http://localhost/api/marketplace/video-intelligence?purgeConfig=true', {
        method: 'DELETE',
      }),
      context,
    );

    expect(await response.json()).toMatchObject({ status: 'uninstalled', configPurged: true });
    expect(mocks.writeConfig).toHaveBeenCalledWith({
      ...deviceConfig,
      enabledTools: ['another-tool'],
      toolConfigs: { 'another-tool': { enabled: true } },
    });
  });
});
