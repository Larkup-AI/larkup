import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  getProjectDataDir as getDataDir,
  requireProjectDataDir as requireDataDir,
} from './project-store';

interface CachedImageAnalysis {
  analysis: string;
  createdAt: string;
}

interface ImageAnalysisCache {
  entries: Record<string, CachedImageAnalysis>;
}

function cacheKey(imageUrl: string, prompt: string) {
  return createHash('sha256')
    .update(`${imageUrl}\n${prompt.trim().replace(/\s+/g, ' ').toLowerCase()}`)
    .digest('hex');
}

async function cachePath(create: boolean): Promise<string | null> {
  const dir = create ? await requireDataDir() : await getDataDir();
  return dir ? path.join(dir, 'image-analysis-cache.json') : null;
}

async function readCache(): Promise<ImageAnalysisCache> {
  const file = await cachePath(false);
  if (!file) return { entries: {} };
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as Partial<ImageAnalysisCache>;
    return { entries: parsed.entries ?? {} };
  } catch {
    return { entries: {} };
  }
}

/** Returns a prior analysis for the exact visual question. Caching answers on
 * disk keeps repeated chart/diagram questions fast across chat sessions. */
export async function getCachedImageAnalysis(imageUrl: string, prompt: string) {
  const cache = await readCache();
  return cache.entries[cacheKey(imageUrl, prompt)]?.analysis;
}

export async function cacheImageAnalysis(imageUrl: string, prompt: string, analysis: string) {
  const file = await cachePath(true);
  if (!file || !analysis.trim()) return;
  const cache = await readCache();
  cache.entries[cacheKey(imageUrl, prompt)] = {
    analysis: analysis.trim(),
    createdAt: new Date().toISOString(),
  };
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(cache, null, 2), 'utf8');
  await fs.rename(temp, file);
}
