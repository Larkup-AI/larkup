import { access, lstat, opendir, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

export interface BuildCacheStatus {
  available: boolean;
  exists: boolean;
  sizeBytes: number;
  answerFeedback?: {
    likedEntries: number;
    sizeBytes: number;
  };
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

async function existingPathSize(candidate: string): Promise<number> {
  try {
    const stats = await lstat(candidate);
    if (stats.isSymbolicLink()) return 0;
    return await directorySizeBytes(candidate);
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    if (code === 'ENOENT') return 0;
    throw error;
  }
}

async function childDirectories(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => path.join(directory, entry.name));
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    if (code === 'ENOENT') return [];
    throw error;
  }
}

function dataRoot(startDirectory: string, override?: string): string {
  if (override) return path.resolve(override);
  const configured = process.env.LARKUP_DATA_DIR?.trim();
  return configured ? path.resolve(configured) : path.join(path.resolve(startDirectory), '.larkup');
}

async function generalCachePaths(startDirectory: string, dataDirectory?: string) {
  const buildCache = await resolveBuildCache(startDirectory);
  const root = dataRoot(startDirectory, dataDirectory);
  const projects = await childDirectories(path.join(root, 'projects'));
  const servers = await childDirectories(path.join(root, 'servers'));
  return {
    removable: [
      ...(buildCache ? [buildCache] : []),
      path.join(root, 'tools', '.npm-cache'),
      ...servers.map((server) => path.join(server, 'generated-server', '.npm-cache')),
    ],
    answerFeedbackFiles: projects.map((project) =>
      path.join(project, 'grounded-answer-cache.json'),
    ),
    derivedFiles: projects.flatMap((project) => [
      path.join(project, 'image-analysis-cache.json'),
      path.join(project, 'video-semantic-index.json'),
    ]),
    videoKnowledgeFiles: projects.map((project) => path.join(project, 'video-knowledge.json')),
    available: buildCache !== null || (await pathExists(root)),
  };
}

async function answerFeedbackCacheStats(file: string) {
  const sizeBytes = await existingPathSize(file);
  if (sizeBytes === 0) return { sizeBytes: 0, likedEntries: 0 };
  try {
    const state = JSON.parse(await readFile(file, 'utf8')) as {
      entries?: Array<{ feedback?: unknown }>;
    };
    const entries = Array.isArray(state.entries) ? state.entries : [];
    const likedEntries = entries.filter((entry) => entry.feedback !== 'disliked');
    return {
      sizeBytes:
        likedEntries.length > 0
          ? Buffer.byteLength(JSON.stringify({ entries: likedEntries }, null, 2))
          : 0,
      // Cache files created before explicit feedback state contained only
      // liked answers, so a missing field remains a positive entry.
      likedEntries: likedEntries.length,
    };
  } catch {
    return { sizeBytes, likedEntries: 0 };
  }
}

async function embeddedVideoCacheSize(file: string): Promise<number> {
  try {
    const state = JSON.parse(await readFile(file, 'utf8')) as {
      artifactAnalysisCache?: unknown[];
      answerMemory?: Array<{ userCorrection?: unknown }>;
    };
    const generatedAnswerMemory = (state.answerMemory ?? [])
      .map((entry) => {
        if (!entry.userCorrection) return entry;
        const cache: Record<string, unknown> = {};
        const value = entry as {
          answer?: unknown;
          evidenceIds?: unknown[];
          unansweredCount?: number;
          lastUnansweredAt?: string;
        };
        if (value.answer !== undefined) cache.answer = value.answer;
        if (value.evidenceIds?.length) cache.evidenceIds = value.evidenceIds;
        if ((value.unansweredCount ?? 0) > 0) cache.unansweredCount = value.unansweredCount;
        if (value.lastUnansweredAt) cache.lastUnansweredAt = value.lastUnansweredAt;
        return cache;
      })
      .filter((entry) => Object.keys(entry).length > 0);
    const artifactAnalysisCache = state.artifactAnalysisCache ?? [];
    // The durable video-knowledge file may remain because it contains source
    // evidence or user corrections. Its two empty cache arrays are structure,
    // not cached data; counting their 46-byte JSON wrapper made a successful
    // clear appear incomplete in Settings.
    if (artifactAnalysisCache.length === 0 && generatedAnswerMemory.length === 0) return 0;
    return Buffer.byteLength(
      JSON.stringify({
        artifactAnalysisCache,
        answerMemory: generatedAnswerMemory,
      }),
    );
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    if (code === 'ENOENT') return 0;
    throw error;
  }
}

async function resolveBuildCache(startDirectory: string) {
  const workspaceRoot = await findWorkspaceRoot(startDirectory);
  if (!workspaceRoot) return null;

  const turboDirectory = path.join(workspaceRoot, '.turbo');
  try {
    const stats = await lstat(turboDirectory);
    // Never follow a user-controlled .turbo link or replace another kind of
    // workspace file. Cache maintenance is deliberately limited to cache/.
    if (!stats.isDirectory() || stats.isSymbolicLink()) return null;
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    if (code !== 'ENOENT') throw error;
  }

  return path.join(turboDirectory, 'cache');
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

/** Reports all rebuildable Larkup caches without counting projects or indexes. */
export async function getGeneralCacheStatus(
  startDirectory = process.cwd(),
  dataDirectory?: string,
): Promise<BuildCacheStatus> {
  const paths = await generalCachePaths(startDirectory, dataDirectory);
  const [sizes, answerFeedback] = await Promise.all([
    Promise.all([
      ...paths.removable.map(existingPathSize),
      ...paths.derivedFiles.map(existingPathSize),
      ...paths.videoKnowledgeFiles.map(embeddedVideoCacheSize),
    ]),
    Promise.all(paths.answerFeedbackFiles.map(answerFeedbackCacheStats)),
  ]);
  const answerFeedbackSummary = answerFeedback.reduce(
    (total, current) => ({
      sizeBytes: total.sizeBytes + current.sizeBytes,
      likedEntries: total.likedEntries + current.likedEntries,
    }),
    { sizeBytes: 0, likedEntries: 0 },
  );
  const sizeBytes =
    sizes.reduce((total, size) => total + size, 0) + answerFeedbackSummary.sizeBytes;
  return {
    available: paths.available,
    exists: sizeBytes > 0,
    sizeBytes,
    answerFeedback: answerFeedbackSummary,
  };
}

/** Clears build/package caches; project-derived caches are cleared through core locks. */
export async function clearGeneralFilesystemCaches(
  startDirectory = process.cwd(),
  dataDirectory?: string,
): Promise<void> {
  const { removable, derivedFiles, answerFeedbackFiles } = await generalCachePaths(
    startDirectory,
    dataDirectory,
  );
  await Promise.all(
    [...removable, ...derivedFiles, ...answerFeedbackFiles].map((candidate) =>
      rm(candidate, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
    ),
  );
}
