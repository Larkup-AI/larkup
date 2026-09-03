import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { InstalledTool } from './types';

const mocks = vi.hoisted(() => ({
  getInstalledTool: vi.fn(),
  resolveWorkspaceToolPath: vi.fn(),
}));

vi.mock('./tool-installer', () => ({
  getInstalledTool: mocks.getInstalledTool,
  resolveWorkspaceToolPath: mocks.resolveWorkspaceToolPath,
}));

import { loadTool, unloadTool } from './tool-loader';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  mocks.getInstalledTool.mockReset();
  mocks.resolveWorkspaceToolPath.mockReset();
  unloadTool('workspace-fixture');
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe('loadTool', () => {
  it('loads an unlinked workspace package from its resolved directory', async () => {
    const packageDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'larkup-tool-loader-'));
    temporaryDirectories.push(packageDirectory);
    await fs.writeFile(
      path.join(packageDirectory, 'package.json'),
      JSON.stringify({ type: 'module', exports: { '.': './index.mjs' } }),
    );
    await fs.writeFile(path.join(packageDirectory, 'index.mjs'), 'export const ready = true;\n');

    mocks.getInstalledTool.mockResolvedValue({
      id: 'workspace-fixture',
      version: '1.0.0',
      installedAt: new Date(0).toISOString(),
      packageName: '@larkup/unlinked-workspace-fixture',
      resolvedPath: packageDirectory,
      source: 'local',
      config: {},
    } satisfies InstalledTool);

    await expect(loadTool<{ ready: boolean }>('workspace-fixture')).resolves.toMatchObject({
      ready: true,
    });
  });

  it('recovers a local tool whose saved workspace path is stale', async () => {
    const packageDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'larkup-tool-loader-'));
    temporaryDirectories.push(packageDirectory);
    await fs.writeFile(
      path.join(packageDirectory, 'package.json'),
      JSON.stringify({ type: 'module', exports: { '.': './index.mjs' } }),
    );
    await fs.writeFile(
      path.join(packageDirectory, 'index.mjs'),
      'export const recovered = true;\n',
    );

    mocks.getInstalledTool.mockResolvedValue({
      id: 'workspace-fixture',
      version: '1.0.0',
      installedAt: new Date(0).toISOString(),
      packageName: '@larkup/unlinked-workspace-fixture',
      resolvedPath: path.join(packageDirectory, 'previous-location'),
      source: 'local',
      config: {},
    } satisfies InstalledTool);
    mocks.resolveWorkspaceToolPath.mockResolvedValue(packageDirectory);

    await expect(loadTool<{ recovered: boolean }>('workspace-fixture')).resolves.toMatchObject({
      recovered: true,
    });
    expect(mocks.resolveWorkspaceToolPath).toHaveBeenCalledWith(
      '@larkup/unlinked-workspace-fixture',
    );
  });

  it('reloads a local tool after it is reinstalled at the same path', async () => {
    const packageDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'larkup-tool-loader-'));
    temporaryDirectories.push(packageDirectory);
    await fs.writeFile(
      path.join(packageDirectory, 'package.json'),
      JSON.stringify({ type: 'module', exports: { '.': './index.mjs' } }),
    );
    await fs.writeFile(path.join(packageDirectory, 'index.mjs'), 'export const revision = 1;\n');

    const installed = {
      id: 'workspace-fixture',
      version: '1.0.0',
      installedAt: new Date(0).toISOString(),
      packageName: '@larkup/unlinked-workspace-fixture',
      resolvedPath: packageDirectory,
      source: 'local',
      config: {},
    } satisfies InstalledTool;
    mocks.getInstalledTool.mockResolvedValue(installed);
    await expect(loadTool<{ revision: number }>('workspace-fixture')).resolves.toMatchObject({
      revision: 1,
    });

    await fs.writeFile(path.join(packageDirectory, 'index.mjs'), 'export const revision = 2;\n');
    mocks.getInstalledTool.mockResolvedValue({
      ...installed,
      installedAt: new Date(1_000).toISOString(),
    });
    await expect(loadTool<{ revision: number }>('workspace-fixture')).resolves.toMatchObject({
      revision: 2,
    });
  });
});
