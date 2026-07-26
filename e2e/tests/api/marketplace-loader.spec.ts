import { expect, test } from '@playwright/test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadTool, unloadTool } from '../../../packages/marketplace/src/tool-loader';

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
