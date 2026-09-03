import { randomUUID } from 'node:crypto';
import { mutateVideoKnowledgeState, readVideoKnowledgeState } from './store';
import type { VideoAnswerMemoryEntry } from './types';

const MAX_ENTRIES_PER_ASSET = 250;

/** Stable exact-match key. Semantic similarity is deliberately not used here. */
export function normalizeVideoAnswerQuestion(question: string) {
  return question.normalize('NFKC').toLocaleLowerCase().trim().replace(/\s+/g, ' ');
}

function cloneAnswer(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function entryFor(
  state: { answerMemory: VideoAnswerMemoryEntry[] },
  mediaAssetId: string,
  knowledgeRevisionId: string,
  questionKey: string,
) {
  return state.answerMemory.find(
    (entry) =>
      entry.mediaAssetId === mediaAssetId &&
      entry.knowledgeRevisionId === knowledgeRevisionId &&
      entry.questionKey === questionKey,
  );
}

/** Read the durable memory for the exact question and active source revision. */
export async function getVideoAnswerMemory(
  mediaAssetId: string,
  knowledgeRevisionId: string,
  question: string,
) {
  const questionKey = normalizeVideoAnswerQuestion(question);
  if (!questionKey) return undefined;
  return (await readVideoKnowledgeState()).answerMemory.find(
    (entry) =>
      entry.mediaAssetId === mediaAssetId &&
      entry.knowledgeRevisionId === knowledgeRevisionId &&
      entry.questionKey === questionKey,
  );
}

/** Save only a response that was already validated against active evidence. */
export function saveVideoAnswerMemory(input: {
  mediaAssetId: string;
  knowledgeRevisionId: string;
  question: string;
  answer: unknown;
  evidenceIds: string[];
}) {
  const questionKey = normalizeVideoAnswerQuestion(input.question);
  if (!questionKey) throw new Error('A video answer memory entry needs a question.');
  return mutateVideoKnowledgeState((state) => {
    const now = new Date().toISOString();
    const existing = entryFor(state, input.mediaAssetId, input.knowledgeRevisionId, questionKey);
    if (existing) {
      existing.answer = cloneAnswer(input.answer);
      existing.evidenceIds = [...new Set(input.evidenceIds)];
      existing.unansweredCount = 0;
      existing.lastUnansweredAt = undefined;
      existing.updatedAt = now;
      return existing;
    }
    const entry: VideoAnswerMemoryEntry = {
      id: randomUUID(),
      mediaAssetId: input.mediaAssetId,
      knowledgeRevisionId: input.knowledgeRevisionId,
      question: input.question.trim(),
      questionKey,
      answer: cloneAnswer(input.answer),
      evidenceIds: [...new Set(input.evidenceIds)],
      unansweredCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    state.answerMemory.push(entry);
    const entriesForAsset = state.answerMemory
      .filter((candidate) => candidate.mediaAssetId === input.mediaAssetId)
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
    for (const stale of entriesForAsset.slice(
      0,
      Math.max(0, entriesForAsset.length - MAX_ENTRIES_PER_ASSET),
    )) {
      state.answerMemory.splice(state.answerMemory.indexOf(stale), 1);
    }
    return entry;
  });
}

/**
 * Keep an explicit user correction in the same revision scope. It is useful
 * for exact repeats, but is never converted to immutable source evidence.
 */
export function saveVideoAnswerCorrection(input: {
  mediaAssetId: string;
  knowledgeRevisionId: string;
  question: string;
  answer: string;
  note?: string;
}) {
  const questionKey = normalizeVideoAnswerQuestion(input.question);
  const answer = input.answer.trim();
  if (!questionKey || !answer) throw new Error('A correction needs both a question and an answer.');
  return mutateVideoKnowledgeState((state) => {
    const now = new Date().toISOString();
    const correction = {
      answer,
      ...(input.note?.trim() ? { note: input.note.trim() } : {}),
      createdAt: now,
    };
    const existing = entryFor(state, input.mediaAssetId, input.knowledgeRevisionId, questionKey);
    if (existing) {
      existing.userCorrection = correction;
      existing.updatedAt = now;
      return existing;
    }
    const entry: VideoAnswerMemoryEntry = {
      id: randomUUID(),
      mediaAssetId: input.mediaAssetId,
      knowledgeRevisionId: input.knowledgeRevisionId,
      question: input.question.trim(),
      questionKey,
      evidenceIds: [],
      userCorrection: correction,
      unansweredCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    state.answerMemory.push(entry);
    return entry;
  });
}

/** Record a miss without caching an unsupported answer. A repeat can trigger bounded refinement. */
export function recordUnansweredVideoQuestion(input: {
  mediaAssetId: string;
  knowledgeRevisionId: string;
  question: string;
}) {
  const questionKey = normalizeVideoAnswerQuestion(input.question);
  if (!questionKey) return Promise.resolve(undefined);
  return mutateVideoKnowledgeState((state) => {
    const now = new Date().toISOString();
    const existing = entryFor(state, input.mediaAssetId, input.knowledgeRevisionId, questionKey);
    if (existing) {
      existing.unansweredCount += 1;
      existing.lastUnansweredAt = now;
      existing.updatedAt = now;
      return existing;
    }
    const entry: VideoAnswerMemoryEntry = {
      id: randomUUID(),
      mediaAssetId: input.mediaAssetId,
      knowledgeRevisionId: input.knowledgeRevisionId,
      question: input.question.trim(),
      questionKey,
      evidenceIds: [],
      unansweredCount: 1,
      lastUnansweredAt: now,
      createdAt: now,
      updatedAt: now,
    };
    state.answerMemory.push(entry);
    return entry;
  });
}

/**
 * Remove mutable answer-level state for one asset without deleting its source
 * evidence or deterministic analysis artifacts. This is appropriate after a
 * retrieval-policy change: the next request starts from grounded evidence.
 */
export function clearVideoAnswerMemory(mediaAssetId: string) {
  return mutateVideoKnowledgeState((state) => {
    const before = state.answerMemory.length;
    state.answerMemory = state.answerMemory.filter((entry) => entry.mediaAssetId !== mediaAssetId);
    return { cleared: before - state.answerMemory.length };
  });
}
