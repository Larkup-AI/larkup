import { lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
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
    const turboStateFile = path.join(workspace, '.turbo', 'daemon', 'state.json');
    const configFile = path.join(workspace, '.larkup', 'projects', 'project-1', 'config.json');
    await mkdir(cacheDirectory, { recursive: true });
    await mkdir(path.dirname(turboStateFile), { recursive: true });
    await mkdir(path.dirname(configFile), { recursive: true });
    await writeFile(path.join(cacheDirectory, 'artifact.bin'), Buffer.alloc(4096));
    await writeFile(turboStateFile, '{"port":4567}');
    await writeFile(configFile, '{"chatApiKey":"secret-key"}');
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
    await expect(readFile(turboStateFile, 'utf8')).resolves.toBe('{"port":4567}');
    await expect(readFile(configFile, 'utf8')).resolves.toBe('{"chatApiKey":"secret-key"}');
  });

  it.skipIf(process.platform === 'win32')('refuses to follow a Turborepo symlink', async () => {
    const workspace = await createWorkspace();
    const target = await mkdtemp(path.join(os.tmpdir(), 'larkup-cache-target-'));
    testDirectories.push(target);
    await writeFile(path.join(target, 'keep.txt'), 'keep');
    await mkdir(path.join(target, 'cache'));
    await writeFile(path.join(target, 'cache', 'artifact.bin'), 'cache');
    await symlink(target, path.join(workspace, '.turbo'));

    await expect(clearBuildCache(workspace)).resolves.toBe(0);

    await expect(accessFile(path.join(target, 'keep.txt'))).resolves.toBe(true);
    await expect(accessFile(path.join(target, 'cache', 'artifact.bin'))).resolves.toBe(true);
  });

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
