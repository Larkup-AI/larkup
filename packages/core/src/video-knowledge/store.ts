import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getProjectDataDir, requireProjectDataDir } from '../project-store';
import type { VideoKnowledgeStoreState } from './types';

const EMPTY_STATE: VideoKnowledgeStoreState = {
  schemaVersion: 1,
  revisions: [],
  jobs: [],
  inspectionReservations: [],
  backgroundRefinements: [],
  artifactAnalysisCache: [],
  answerMemory: [],
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
  const dir = create ? await requireProjectDataDir() : await getProjectDataDir();
  return dir ? path.join(dir, 'video-knowledge.json') : null;
}

function isMissing(error: unknown) {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

async function readStateUncached(file: string): Promise<VideoKnowledgeStoreState> {
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

// A single indexed video reaches tens of megabytes of evidence, and one chat
// answer reads this state a dozen times across retrieval, investigation, and
// verification. Re-parsing it per call dominated interactive latency, so the
// parsed document is memoized against the file's identity (mtime + size) and
// re-read the moment anything -- this process or another -- rewrites it.
let cached: { key: string; state: VideoKnowledgeStoreState } | null = null;

/**
 * Read-only view of the active workspace's video knowledge. Callers must
 * treat the result as immutable; `mutateVideoKnowledgeState` is the only
 * supported way to change it.
 */
export async function readVideoKnowledgeState(): Promise<VideoKnowledgeStoreState> {
  const file = await dataPath(false);
  if (!file) return cloneEmpty();
  let key: string;
  try {
    const stat = await fs.stat(file);
    key = `${file}:${stat.mtimeMs}:${stat.size}`;
  } catch (error) {
    if (isMissing(error)) return cloneEmpty();
    throw error;
  }
  if (cached?.key === key) return cached.state;
  const state = await readStateUncached(file);
  cached = { key, state };
  return state;
}

/** Drops the memoized document so the next read re-parses from disk. */
export function invalidateVideoKnowledgeStateCache(): void {
  cached = null;
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
      // Never mutate the memoized read-only document: this transaction owns
      // a private copy, and the cache is dropped so readers pick the write up.
      const file = await dataPath(false);
      const state = file ? await readStateUncached(file) : cloneEmpty();
      const result = await mutate(state);
      await writeState(state);
      invalidateVideoKnowledgeStateCache();
      return result;
    } finally {
      await release();
    }
  });
  writeChain = run.catch(() => {});
  return run;
}
