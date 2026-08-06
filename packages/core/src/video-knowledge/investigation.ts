import { readVideoKnowledgeState } from './store';
import type { TimeRange } from './types';

export interface VideoHierarchyNode {
  id: string;
  title: string;
  summary: string;
  timeRange: TimeRange;
  evidenceCount: number;
  score: number;
}

export interface VideoInvestigationPlan {
  mediaAssetId: string;
  knowledgeRevisionId: string;
  question: string;
  chapters: VideoHierarchyNode[];
  scenes: VideoHierarchyNode[];
  events: VideoHierarchyNode[];
  states: VideoHierarchyNode[];
  candidateRanges: Array<TimeRange & { reason: string }>;
  strategy: 'answer-from-evidence' | 'inspect-candidate-ranges' | 'establish-broad-context';
  cache: 'hit' | 'miss';
}

const CACHE_TTL_MS = 2 * 60_000;
const planCache = new Map<string, { expiresAt: number; value: VideoInvestigationPlan }>();

function termsFor(question: string) {
  return [
    ...new Set(
      question
        .normalize('NFKC')
        .toLocaleLowerCase()
        .match(/[\p{Letter}\p{Number}][\p{Letter}\p{Mark}\p{Number}_-]*/gu) ?? [],
    ),
  ];
}

function scoreText(text: string, terms: string[]) {
  if (terms.length === 0) return 0;
  const normalized = text.normalize('NFKC').toLocaleLowerCase();
  return terms.filter((term) => normalized.includes(term)).length / terms.length;
}

function textValue(value: unknown) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && !Array.isArray(value) && 'text' in value) {
    return String((value as { text?: unknown }).text ?? '');
  }
  return JSON.stringify(value);
}

function take<T extends VideoHierarchyNode>(items: T[], limit: number) {
  return items
    .sort(
      (left, right) =>
        right.score - left.score || left.timeRange.startSecs - right.timeRange.startSecs,
    )
    .slice(0, limit);
}

/**
 * Builds a compact temporal tree for every question. This is deterministic and
 * cacheable: language models decide what to inspect, but never invent ranges
 * that are absent from the active revision.
 */
export async function planVideoInvestigation(
  mediaAssetId: string,
  question: string,
): Promise<VideoInvestigationPlan | undefined> {
  const state = await readVideoKnowledgeState();
  const manifest = state.manifests
    .filter((item) => item.mediaAssetId === mediaAssetId && item.activatedAt)
    .sort((left, right) => right.activatedAt!.localeCompare(left.activatedAt!))[0];
  if (!manifest) return undefined;
  const cacheKey = `${manifest.knowledgeRevisionId}:${question
    .normalize('NFKC')
    .toLocaleLowerCase()
    .trim()}`;
  const cached = planCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return { ...cached.value, cache: 'hit' };

  const terms = termsFor(question);
  const activeEvidenceIds = new Set(Object.values(manifest.activeEvidenceRevisionIds));
  const evidenceByLineage = new Map(
    state.evidence
      .filter((item) => item.mediaAssetId === mediaAssetId && activeEvidenceIds.has(item.id))
      .map((item) => [item.lineageId, item]),
  );
  const evidenceText = (lineageIds: string[]) =>
    lineageIds
      .map((id) => evidenceByLineage.get(id))
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .map((item) => textValue(item.payload))
      .join('\n');
  const revisionId = manifest.knowledgeRevisionId;

  const scenes = take(
    state.scenes
      .filter(
        (item) => item.mediaAssetId === mediaAssetId && item.knowledgeRevisionId === revisionId,
      )
      .map((item) => {
        const summary = evidenceText(item.evidenceLineageIds).slice(0, 700);
        return {
          id: item.id,
          title: item.title,
          summary,
          timeRange: item.timeRange,
          evidenceCount: item.evidenceLineageIds.length,
          score: scoreText(`${item.title}\n${summary}`, terms),
        };
      }),
    8,
  );
  const chapters = take(
    state.chapters
      .filter(
        (item) => item.mediaAssetId === mediaAssetId && item.knowledgeRevisionId === revisionId,
      )
      .map((item) => {
        const summary = evidenceText(item.evidenceLineageIds).slice(0, 900);
        return {
          id: item.id,
          title: item.title,
          summary,
          timeRange: item.timeRange,
          evidenceCount: item.evidenceLineageIds.length,
          score: scoreText(`${item.title}\n${summary}`, terms),
        };
      }),
    4,
  );
  const events = take(
    state.events
      .filter(
        (item) => item.mediaAssetId === mediaAssetId && item.knowledgeRevisionId === revisionId,
      )
      .map((item) => ({
        id: item.id,
        title: item.type,
        summary: item.description,
        timeRange: item.timeRange,
        evidenceCount: item.evidenceLineageIds.length,
        score: scoreText(`${item.type}\n${item.description}`, terms),
      })),
    12,
  );
  const states = take(
    state.states
      .filter(
        (item) => item.mediaAssetId === mediaAssetId && item.knowledgeRevisionId === revisionId,
      )
      .map((item) => ({
        id: item.id,
        title: `${item.subject} · ${item.property}`,
        summary: textValue(item.value),
        timeRange: item.timeRange,
        evidenceCount: item.evidenceLineageIds.length,
        score: scoreText(`${item.subject} ${item.property} ${textValue(item.value)}`, terms),
      })),
    12,
  );

  const ranked = [...events, ...states, ...scenes, ...chapters].filter((item) => item.score > 0);
  const candidateRanges = ranked
    .slice(0, 6)
    .map((item) => ({ ...item.timeRange, reason: item.title }));
  const value: VideoInvestigationPlan = {
    mediaAssetId,
    knowledgeRevisionId: revisionId,
    question,
    chapters,
    scenes,
    events,
    states,
    candidateRanges,
    strategy:
      candidateRanges.length > 0
        ? 'answer-from-evidence'
        : chapters.length > 0 || scenes.length > 0
        ? 'establish-broad-context'
        : 'inspect-candidate-ranges',
    cache: 'miss',
  };
  planCache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}
