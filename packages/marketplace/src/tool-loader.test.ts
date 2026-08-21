import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { InstalledTool } from './types';

const mocks = vi.hoisted(() => ({ getInstalledTool: vi.fn() }));

vi.mock('./tool-installer', () => ({
  getInstalledTool: mocks.getInstalledTool,
}));

import { loadTool, unloadTool } from './tool-loader';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  mocks.getInstalledTool.mockReset();
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
});
