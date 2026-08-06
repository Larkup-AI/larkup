import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getDataDir, requireDataDir } from '../workspace';
import type { VideoKnowledgeStoreState } from './types';

const EMPTY_STATE: VideoKnowledgeStoreState = {
  schemaVersion: 1,
  revisions: [],
  jobs: [],
  inspectionReservations: [],
  backgroundRefinements: [],
  artifactAnalysisCache: [],
  artifacts: [],
  evidence: [],
  observations: [],
  states: [],
  transitions: [],
  events: [],
  scenes: [],
  chapters: [],
  summaries: [],
  derived: [],
  conflicts: [],
  manifests: [],
  projections: [],
};

let writeChain: Promise<unknown> = Promise.resolve();
const LOCK_STALE_MS = 5 * 60_000;
const LOCK_ATTEMPTS = 500;

function cloneEmpty(): VideoKnowledgeStoreState {
  return structuredClone(EMPTY_STATE);
}

async function dataPath(create: boolean): Promise<string | null> {
  const dir = create ? await requireDataDir() : await getDataDir();
  return dir ? path.join(dir, 'video-knowledge.json') : null;
}

function isMissing(error: unknown) {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

export async function readVideoKnowledgeState(): Promise<VideoKnowledgeStoreState> {
  const file = await dataPath(false);
  if (!file) return cloneEmpty();
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as Partial<VideoKnowledgeStoreState>;
    if (parsed.schemaVersion !== 1)
      throw new Error(`Unsupported video knowledge schema at ${file}.`);
    return { ...cloneEmpty(), ...parsed };
  } catch (error) {
    if (isMissing(error)) return cloneEmpty();
    throw error;
  }
}

async function writeState(state: VideoKnowledgeStoreState): Promise<void> {
  const file = await dataPath(true);
  if (!file) return;
  const temp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await fs.writeFile(temp, JSON.stringify(state, null, 2), 'utf8');
    await fs.rename(temp, file);
  } catch (error) {
    await fs.unlink(temp).catch(() => {});
    throw error;
  }
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Serializes read/modify/write across Node processes as well as within one
 * process. Playwright workers, the CLI, and the web worker can all target the
 * same workspace file, so the in-memory promise chain alone is insufficient.
 */
async function acquireStateLock(): Promise<() => Promise<void>> {
  const file = await dataPath(true);
  if (!file) return async () => {};
  const lock = `${file}.lock`;
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
    try {
      const handle = await fs.open(lock, 'wx');
      await handle.writeFile(`${process.pid}:${new Date().toISOString()}`);
      return async () => {
        await handle.close().catch(() => {});
        await fs.unlink(lock).catch(() => {});
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        const stat = await fs.stat(lock);
        if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
          await fs.unlink(lock).catch(() => {});
        }
      } catch (statError) {
        if (!isMissing(statError)) throw statError;
      }
      await delay(Math.min(50, 5 + attempt));
    }
  }
  throw new Error(`Timed out waiting for the video knowledge state lock: ${lock}`);
}

/** Atomic read/modify/write transaction scoped to the active Larkup workspace. */
export function mutateVideoKnowledgeState<T>(
  mutate: (state: VideoKnowledgeStoreState) => T | Promise<T>,
): Promise<T> {
  const run = writeChain.then(async () => {
    const release = await acquireStateLock();
    try {
      const state = await readVideoKnowledgeState();
      const result = await mutate(state);
      await writeState(state);
      return result;
    } finally {
      await release();
    }
  });
  writeChain = run.catch(() => {});
  return run;
}
