import { lstat, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { clearBuildCache, findWorkspaceRoot, getBuildCacheStatus } from './system-cache';

const testDirectories: string[] = [];

async function createWorkspace() {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'larkup-cache-test-'));
  testDirectories.push(workspace);
  await writeFile(path.join(workspace, 'turbo.json'), '{}');
  await writeFile(path.join(workspace, 'pnpm-workspace.yaml'), 'packages: []');
  return workspace;
}

afterEach(async () => {
  await Promise.all(
    testDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe('system cache maintenance', () => {
  it('finds the workspace from a nested app directory', async () => {
    const workspace = await createWorkspace();
    const appDirectory = path.join(workspace, 'apps', 'web');
    await mkdir(appDirectory, { recursive: true });

    await expect(findWorkspaceRoot(appDirectory)).resolves.toBe(workspace);
  });

  it('reports and clears only the workspace Turborepo cache', async () => {
    const workspace = await createWorkspace();
    const cacheDirectory = path.join(workspace, '.turbo', 'cache');
    await mkdir(cacheDirectory, { recursive: true });
    await writeFile(path.join(cacheDirectory, 'artifact.bin'), Buffer.alloc(4096));
    await writeFile(path.join(workspace, 'keep.txt'), 'keep');

    const before = await getBuildCacheStatus(workspace);
    expect(before.available).toBe(true);
    expect(before.exists).toBe(true);
    expect(before.sizeBytes).toBeGreaterThanOrEqual(4096);

    await expect(clearBuildCache(workspace)).resolves.toBe(before.sizeBytes);
    await expect(getBuildCacheStatus(workspace)).resolves.toEqual({
      available: true,
      exists: false,
      sizeBytes: 0,
    });
    await expect(accessFile(path.join(workspace, 'keep.txt'))).resolves.toBe(true);
  });

  it.skipIf(process.platform === 'win32')(
    'removes a cache symlink without touching its target',
    async () => {
      const workspace = await createWorkspace();
      const target = await mkdtemp(path.join(os.tmpdir(), 'larkup-cache-target-'));
      testDirectories.push(target);
      await writeFile(path.join(target, 'keep.txt'), 'keep');
      await symlink(target, path.join(workspace, '.turbo'));

      await clearBuildCache(workspace);

      await expect(accessFile(path.join(target, 'keep.txt'))).resolves.toBe(true);
    },
  );

  it('is unavailable outside a recognized source workspace', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'larkup-installed-test-'));
    testDirectories.push(directory);

    await expect(getBuildCacheStatus(directory)).resolves.toEqual({
      available: false,
      exists: false,
      sizeBytes: 0,
    });
    await expect(clearBuildCache(directory)).resolves.toBe(0);
  });
});

async function accessFile(file: string): Promise<boolean> {
  try {
    await lstat(file);
    return true;
  } catch {
    return false;
  }
}
