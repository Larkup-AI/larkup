import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getProjectDataDir, requireProjectDataDir } from './project-store';

export interface GroundedAnswerCacheEntry {
  id: string;
  question: string;
  questionKey: string;
  feedback: 'liked' | 'disliked';
  answer?: string;
  sourceScopeFingerprint: string;
  createdAt: string;
  updatedAt: string;
}

interface GroundedAnswerCacheState {
  entries: GroundedAnswerCacheEntry[];
}

const MAX_ENTRIES = 250;
let writeChain: Promise<unknown> = Promise.resolve();

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const run = writeChain.then(operation, operation);
  writeChain = run.catch(() => undefined);
  return run;
}

export function normalizeGroundedAnswerQuestion(question: string) {
  return question.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

async function cachePath(create: boolean): Promise<string | null> {
  const directory = create ? await requireProjectDataDir() : await getProjectDataDir();
  return directory ? path.join(directory, 'grounded-answer-cache.json') : null;
}

async function readState(): Promise<GroundedAnswerCacheState> {
  const file = await cachePath(false);
  if (!file) return { entries: [] };
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as Partial<GroundedAnswerCacheState>;
    return { entries: Array.isArray(parsed.entries) ? parsed.entries : [] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { entries: [] };
    // A cache is disposable. A partial/corrupt cache write must never prevent
    // Chat from falling back to normal retrieval or from replacing the file.
    if (error instanceof SyntaxError) return { entries: [] };
    throw error;
  }
}

async function writeState(file: string, state: GroundedAnswerCacheState): Promise<void> {
  const temporaryFile = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await fs.writeFile(temporaryFile, JSON.stringify(state, null, 2), 'utf8');
    await fs.rename(temporaryFile, file);
  } catch (error) {
    await fs.unlink(temporaryFile).catch(() => undefined);
    throw error;
  }
}

/** Finds the liked answer for an exact normalized question, if one exists. */
export async function getGroundedAnswerCacheEntry(question: string) {
  const questionKey = normalizeGroundedAnswerQuestion(question);
  if (!questionKey) return undefined;
  return (await readState()).entries.find((entry) => entry.questionKey === questionKey);
}

/** Saves a user-approved answer. Source-scope validation happens at the API boundary. */
export function saveGroundedAnswerCacheEntry(input: {
  question: string;
  answer: string;
  sourceScopeFingerprint: string;
}) {
  return serialize(async () => {
    const question = input.question.trim();
    const answer = input.answer.trim();
    const questionKey = normalizeGroundedAnswerQuestion(question);
    if (!questionKey || !answer || !input.sourceScopeFingerprint) {
      throw new Error('A grounded answer cache entry needs a question, answer, and source scope.');
    }

    const file = await cachePath(true);
    if (!file) throw new Error('An active Project is required.');
    const state = await readState();
    const now = new Date().toISOString();
    const current = state.entries.find((entry) => entry.questionKey === questionKey);
    const entry: GroundedAnswerCacheEntry = current
      ? {
          ...current,
          question,
          feedback: 'liked',
          answer,
          sourceScopeFingerprint: input.sourceScopeFingerprint,
          updatedAt: now,
        }
      : {
          id: randomUUID(),
          question,
          questionKey,
          feedback: 'liked',
          answer,
          sourceScopeFingerprint: input.sourceScopeFingerprint,
          createdAt: now,
          updatedAt: now,
        };
    const entries = [
      ...state.entries.filter((candidate) => candidate.questionKey !== questionKey),
      entry,
    ]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, MAX_ENTRIES);
    await writeState(file, { entries });
    return entry;
  });
}

/** Keeps negative feedback globally without retaining the rejected answer. */
export function saveGroundedAnswerDislike(input: {
  question: string;
  sourceScopeFingerprint: string;
}) {
  return serialize(async () => {
    const question = input.question.trim();
    const questionKey = normalizeGroundedAnswerQuestion(question);
    if (!questionKey || !input.sourceScopeFingerprint) {
      throw new Error('A disliked grounded answer needs a question and source scope.');
    }

    const file = await cachePath(true);
    if (!file) throw new Error('An active Project is required.');
    const state = await readState();
    const now = new Date().toISOString();
    const current = state.entries.find((entry) => entry.questionKey === questionKey);
    const entry: GroundedAnswerCacheEntry = {
      id: current?.id ?? randomUUID(),
      question,
      questionKey,
      feedback: 'disliked',
      sourceScopeFingerprint: input.sourceScopeFingerprint,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    };
    const entries = [
      ...state.entries.filter((candidate) => candidate.questionKey !== questionKey),
      entry,
    ]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, MAX_ENTRIES);
    await writeState(file, { entries });
    return entry;
  });
}

/** Removes any liked-answer cache entry for an exact normalized question. */
export function deleteGroundedAnswerCacheEntry(question: string) {
  return serialize(async () => {
    const questionKey = normalizeGroundedAnswerQuestion(question);
    if (!questionKey) return false;
    const file = await cachePath(false);
    if (!file) return false;
    const state = await readState();
    const entries = state.entries.filter((entry) => entry.questionKey !== questionKey);
    if (entries.length === state.entries.length) return false;
    if (entries.length === 0) {
      await fs.unlink(file).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    } else {
      await writeState(file, { entries });
    }
    return true;
  });
}

/** Clears all liked grounded answers for the active Project. */
export async function clearGroundedAnswerCache(): Promise<void> {
  const file = await cachePath(false);
  if (!file) return;
  await fs.unlink(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
}
