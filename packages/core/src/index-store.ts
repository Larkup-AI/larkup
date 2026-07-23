import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { IndexRun } from './types';
import { getDataDir, requireDataDir } from './workspace';

/**
 * File-backed state for the current/last indexing run, scoped to the active
 * server. The indexer writes progress here as it works; the Index stage UI
 * polls it. One run per server is tracked at a time. Writes are serialized to
 * avoid progress updates clobbering each other.
 */

let writeChain: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.catch(() => {});
  return run;
}

async function runPath(create: boolean): Promise<string | null> {
  const dir = create ? await requireDataDir() : await getDataDir();
  if (!dir) return null;
  return path.join(dir, 'index-run.json');
}

export async function readRun(): Promise<IndexRun | null> {
  const file = await runPath(false);
  if (!file) return null;
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw) as IndexRun;
  } catch {
    return null;
  }
}

export function writeRun(run: IndexRun): Promise<IndexRun> {
  return serialize(async () => {
    const file = await runPath(true);
    const next = { ...run, updatedAt: new Date().toISOString() };
    if (file) await fs.writeFile(file, JSON.stringify(next, null, 2), 'utf8');
    return next;
  });
}

/** Atomically create a run only when no other index worker owns the store. */
export function claimRun(run: IndexRun): Promise<IndexRun> {
  return serialize(async () => {
    const current = await readRun();
    if (
      current &&
      (current.status === 'chunking' ||
        current.status === 'embedding' ||
        current.status === 'upserting')
    ) {
      throw new Error('An indexing run is already in progress.');
    }
    const file = await runPath(true);
    const next = { ...run, updatedAt: new Date().toISOString() };
    if (file) await fs.writeFile(file, JSON.stringify(next, null, 2), 'utf8');
    return next;
  });
}

/** Patch the persisted run (read-modify-write). */
export function patchRun(
  patch: Partial<IndexRun>,
  expectedRunId?: string,
): Promise<IndexRun | null> {
  return serialize(async () => {
    const current = await readRun();
    if (!current) return null;
    if (expectedRunId && current.id !== expectedRunId) return null;
    const next: IndexRun = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    const file = await runPath(true);
    if (file) await fs.writeFile(file, JSON.stringify(next, null, 2), 'utf8');
    return next;
  });
}

export async function isRunning(): Promise<boolean> {
  const run = await readRun();
  return Boolean(
    run && (run.status === 'chunking' || run.status === 'embedding' || run.status === 'upserting'),
  );
}
