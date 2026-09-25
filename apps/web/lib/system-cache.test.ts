import { lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearBuildCache,
  clearGeneralFilesystemCaches,
  findWorkspaceRoot,
  getBuildCacheStatus,
  getGeneralCacheStatus,
} from './system-cache';

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

  it('tracks and clears rebuildable project and package caches together', async () => {
    const workspace = await createWorkspace();
    const dataRoot = path.join(workspace, 'larkup-data');
    const project = path.join(dataRoot, 'projects', 'project-1');
    const toolCache = path.join(dataRoot, 'tools', '.npm-cache');
    const generatedCache = path.join(
      dataRoot,
      'servers',
      'server-1',
      'generated-server',
      '.npm-cache',
    );
    await Promise.all([
      mkdir(project, { recursive: true }),
      mkdir(toolCache, { recursive: true }),
      mkdir(generatedCache, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(
        path.join(project, 'grounded-answer-cache.json'),
        JSON.stringify({
          entries: [{ feedback: 'liked' }, { feedback: 'disliked' }],
        }),
      ),
      writeFile(path.join(project, 'image-analysis-cache.json'), Buffer.alloc(1024)),
      writeFile(path.join(project, 'video-semantic-index.json'), Buffer.alloc(2048)),
      writeFile(path.join(toolCache, 'package.bin'), Buffer.alloc(4096)),
      writeFile(path.join(generatedCache, 'package.bin'), Buffer.alloc(8192)),
      writeFile(path.join(project, 'documents.json'), '[{"content":"keep"}]'),
    ]);

    const before = await getGeneralCacheStatus(workspace, dataRoot);
    expect(before.available).toBe(true);
    expect(before.sizeBytes).toBeGreaterThan(15 * 1024);
    expect(before.answerFeedback).toEqual({
      likedEntries: 1,
      sizeBytes: expect.any(Number),
    });

    await clearGeneralFilesystemCaches(workspace, dataRoot);
    await expect(getGeneralCacheStatus(workspace, dataRoot)).resolves.toEqual({
      available: true,
      exists: false,
      sizeBytes: 0,
      answerFeedback: { likedEntries: 0, sizeBytes: 0 },
    });
    await expect(readFile(path.join(project, 'documents.json'), 'utf8')).resolves.toContain('keep');
  });

  it('does not report the empty video cache container as 46 bytes of cache', async () => {
    const workspace = await createWorkspace();
    const dataRoot = path.join(workspace, 'larkup-data');
    const project = path.join(dataRoot, 'projects', 'project-1');
    await mkdir(project, { recursive: true });
    await writeFile(
      path.join(project, 'video-knowledge.json'),
      JSON.stringify({
        artifactAnalysisCache: [],
        answerMemory: [{ userCorrection: { text: 'Keep this correction.' } }],
        evidence: [{ id: 'source-evidence-that-must-remain' }],
      }),
    );

    await expect(getGeneralCacheStatus(workspace, dataRoot)).resolves.toEqual({
      available: true,
      exists: false,
      sizeBytes: 0,
      answerFeedback: { likedEntries: 0, sizeBytes: 0 },
    });
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
