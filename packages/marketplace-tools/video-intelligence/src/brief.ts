import type { VideoIndexingBrief, VideoIndexingMode } from './contracts.js';
const MODES = new Set<VideoIndexingMode>(['fast', 'balanced', 'thorough']);

function normalizeMode(value: unknown): VideoIndexingMode {
  return MODES.has(value as VideoIndexingMode) ? (value as VideoIndexingMode) : 'balanced';
}

export function createVideoIndexingBrief(
  input: Partial<VideoIndexingBrief> = {},
): VideoIndexingBrief {
  const contentType = input.contentType?.trim().slice(0, 120) || 'general';
  const indexingMode = normalizeMode(input.indexingMode);
  const retainSourceHours = Number.isFinite(input.retainSourceHours)
    ? Math.max(0, Math.min(720, Math.floor(input.retainSourceHours!)))
    : 0;
  return {
    goal: input.goal?.trim().slice(0, 4_000) || undefined,
    contentType,
    knownEntities: uniqueStrings(input.knownEntities, 50),
    expectedQuestions: uniqueStrings(input.expectedQuestions, 20),
    language: input.language?.trim().slice(0, 32) || 'auto',
    importantRanges: (input.importantRanges ?? [])
      .filter(
        (range) =>
          Number.isFinite(range.startSecs) &&
          Number.isFinite(range.endSecs) &&
          range.startSecs >= 0 &&
          range.endSecs > range.startSecs,
      )
      .slice(0, 20)
      .map((range) => ({
        startSecs: range.startSecs,
        endSecs: range.endSecs,
        note: range.note?.trim().slice(0, 500) || undefined,
      })),
    indexingMode,
    processingAuthorityConfirmed: input.processingAuthorityConfirmed === true,
    retainSourceHours,
  };
}

function uniqueStrings(values: string[] | undefined, limit: number): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))]
    .slice(0, limit)
    .map((value) => value.slice(0, 500));
}
