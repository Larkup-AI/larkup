import { access, lstat, opendir, rm } from 'node:fs/promises';
import path from 'node:path';

export interface BuildCacheStatus {
  available: boolean;
  exists: boolean;
  sizeBytes: number;
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

export async function findWorkspaceRoot(startDirectory = process.cwd()): Promise<string | null> {
  let current = path.resolve(startDirectory);

  while (true) {
    if (
      (await pathExists(path.join(current, 'turbo.json'))) &&
      (await pathExists(path.join(current, 'pnpm-workspace.yaml')))
    ) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function directorySizeBytes(directory: string): Promise<number> {
  const stats = await lstat(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) return stats.size;

  let total = stats.size;
  const entries = await opendir(directory);
  for await (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      total += await directorySizeBytes(entryPath);
    } else {
      total += (await lstat(entryPath)).size;
    }
  }
  return total;
}

async function resolveBuildCache(startDirectory: string) {
  const workspaceRoot = await findWorkspaceRoot(startDirectory);
  if (!workspaceRoot) return null;
  return path.join(workspaceRoot, '.turbo');
}

export async function getBuildCacheStatus(
  startDirectory = process.cwd(),
): Promise<BuildCacheStatus> {
  const cacheDirectory = await resolveBuildCache(startDirectory);
  if (!cacheDirectory) return { available: false, exists: false, sizeBytes: 0 };

  try {
    return {
      available: true,
      exists: true,
      sizeBytes: await directorySizeBytes(cacheDirectory),
    };
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    if (code === 'ENOENT') return { available: true, exists: false, sizeBytes: 0 };
    throw error;
  }
}

export async function clearBuildCache(startDirectory = process.cwd()): Promise<number> {
  const cacheDirectory = await resolveBuildCache(startDirectory);
  if (!cacheDirectory) return 0;

  const { sizeBytes } = await getBuildCacheStatus(startDirectory);
  await rm(cacheDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  return sizeBytes;
}
