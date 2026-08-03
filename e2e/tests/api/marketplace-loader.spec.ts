import { expect, test } from '@playwright/test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadTool, unloadTool } from '../../../packages/marketplace/src/tool-loader';
import { mergeToolDescriptors } from '../../../packages/marketplace/src/tool-registry';
import type { ToolDescriptor } from '../../../packages/marketplace/src/types';
import {
  getInstalledTools,
  isToolInstalled,
  uninstallTool,
} from '../../../packages/marketplace/src/tool-installer';

function videoTool(version: string): ToolDescriptor {
  return {
    id: 'video-audio',
    name: 'Video & Audio',
    description: 'Test tool',
    category: 'media',
    version,
    pricing: 'free',
    icon: 'Film',
    packageName: '@larkup/tool-video-audio',
    installSize: '~15 MB',
    author: 'Larkup',
    capabilities: [],
    downloads: 0,
  };
}

test('keeps a newer marketplace catalog entry when an installed tool manifest is stale', () => {
  const merged = mergeToolDescriptors(
    { 'video-audio': videoTool('0.3.4') },
    { 'video-audio': videoTool('0.3.2') },
  );

  expect(merged['video-audio'].version).toBe('0.3.4');
});

test('bundled first-party tools are not marked installed until the user installs them', async () => {
  const originalCwd = process.cwd();
  const workspace = await mkdtemp(path.join(tmpdir(), 'larkup-marketplace-empty-'));
  try {
    process.chdir(workspace);
    await expect(getInstalledTools()).resolves.toEqual([]);
  } finally {
    process.chdir(originalCwd);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('uninstall removes the persisted Marketplace state immediately', async () => {
  const originalCwd = process.cwd();
  const workspace = await mkdtemp(path.join(tmpdir(), 'larkup-marketplace-uninstall-'));
  try {
    await mkdir(path.join(workspace, '.larkup', 'tools'), { recursive: true });
    await writeFile(
      path.join(workspace, '.larkup', 'tools', 'installed.json'),
      JSON.stringify({
        tools: [
          {
            id: 'video-audio',
            version: '0.2.0',
            installedAt: new Date().toISOString(),
            packageName: '@larkup/tool-video-audio',
            resolvedPath: '@larkup/tool-video-audio',
            source: 'local',
            config: {},
          },
        ],
        downloadCounts: {},
      }),
    );
    process.chdir(workspace);
    await expect(isToolInstalled('video-audio')).resolves.toBe(true);
    await uninstallTool('video-audio');
    await expect(isToolInstalled('video-audio')).resolves.toBe(false);
  } finally {
    process.chdir(originalCwd);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('loads an isolated ESM marketplace package through its exported entry point', async () => {
  const originalCwd = process.cwd();
  const workspace = await mkdtemp(path.join(tmpdir(), 'larkup-tool-loader-'));
  const packageDir = path.join(workspace, '.larkup/tools/node_modules/@test/isolated-tool');

  try {
    await mkdir(path.join(packageDir, 'dist'), { recursive: true });
    await writeFile(
      path.join(packageDir, 'package.json'),
      JSON.stringify({
        name: '@test/isolated-tool',
        type: 'module',
        exports: { '.': { import: './dist/index.js' } },
      }),
    );
    await writeFile(path.join(packageDir, 'dist/index.js'), 'export const ready = true;');
    await writeFile(
      path.join(workspace, '.larkup/tools/installed.json'),
      JSON.stringify({
        tools: [
          {
            id: 'isolated-loader-test',
            version: '1.0.0',
            installedAt: new Date().toISOString(),
            packageName: '@test/isolated-tool',
            resolvedPath: packageDir,
            source: 'registry',
            config: {},
          },
        ],
        downloadCounts: {},
        updatedAt: new Date().toISOString(),
      }),
    );

    process.chdir(workspace);
    const tool = await loadTool<{ ready: boolean }>('isolated-loader-test');
    expect(tool?.ready).toBe(true);
  } finally {
    unloadTool('isolated-loader-test');
    process.chdir(originalCwd);
    await rm(workspace, { recursive: true, force: true });
  }
});
