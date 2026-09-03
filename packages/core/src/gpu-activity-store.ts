import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  getProjectDataDir as getDataDir,
  requireProjectDataDir as requireDataDir,
} from './project-store';

/**
 * File-backed state for the current chat-triggered GPU dispatch (a bounded
 * video re-inspection). The tool call writes progress here as the remote
 * worker starts up and runs; a small floating UI polls it so a slow cold
 * start looks like visible progress instead of a silent wait. Mirrors
 * index-store.ts's pattern (one active record, serialized writes).
 */

export interface GpuActivity {
  id: string;
  label: string;
  message: string;
  percent: number;
  startedAt: string;
  updatedAt: string;
  /**
   * 'waking-up': the GPU worker hasn't picked up the job yet (cold start) --
   * shown by the global bottom-right indicator only.
   * 'analyzing': the worker is actively processing -- shown inline in the
   * chat transcript, matched to its tool call by `toolCallId`, never as a
   * floating indicator.
   */
  phase: 'waking-up' | 'analyzing';
  /** The chat tool call this activity belongs to, when dispatched from chat. */
  toolCallId?: string;
}

// An orphaned record (process crashed mid-call) must not show a permanently
// stuck indicator -- treat anything older than this as cleared.
const STALE_MS = 5 * 60_000;

let writeChain: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.catch(() => {});
  return run;
}

async function activityPath(create: boolean): Promise<string | null> {
  const dir = create ? await requireDataDir() : await getDataDir();
  if (!dir) return null;
  return path.join(dir, 'gpu-activity.json');
}

export async function readGpuActivity(): Promise<GpuActivity | null> {
  const file = await activityPath(false);
  if (!file) return null;
  try {
    const raw = await fs.readFile(file, 'utf8');
    const activity = JSON.parse(raw) as GpuActivity;
    if (Date.now() - new Date(activity.updatedAt).getTime() > STALE_MS) return null;
    return activity;
  } catch {
    return null;
  }
}

export function writeGpuActivity(
  patch: Pick<GpuActivity, 'id' | 'label' | 'message' | 'percent' | 'phase'> &
    Partial<Pick<GpuActivity, 'toolCallId'>>,
): Promise<void> {
  return serialize(async () => {
    const file = await activityPath(true);
    if (!file) return;
    const now = new Date().toISOString();
    const existing = await readGpuActivity();
    const sameJob = existing?.id === patch.id;
    const next: GpuActivity = {
      ...patch,
      // A transient relay hiccup upstream must never visibly rewind
      // progress for the same job -- only a genuinely new job (a different
      // id) is allowed to start back at a lower percent.
      percent: sameJob ? Math.max(existing.percent, patch.percent) : patch.percent,
      startedAt: sameJob ? existing.startedAt : now,
      updatedAt: now,
    };
    // Readers poll while analysis is running. Replacing the file atomically
    // prevents them from observing a half-written JSON document and briefly
    // clearing the progress card between otherwise valid updates.
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(next), 'utf8');
    await fs.rename(temporary, file);
  });
}

/** No-ops if a newer activity has already replaced this one. */
export function clearGpuActivity(id: string): Promise<void> {
  return serialize(async () => {
    const file = await activityPath(false);
    if (!file) return;
    const existing = await readGpuActivity();
    if (!existing || existing.id !== id) return;
    await fs.rm(file, { force: true });
  });
}
