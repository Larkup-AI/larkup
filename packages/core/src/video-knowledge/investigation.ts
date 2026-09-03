import { readVideoKnowledgeState } from './store';
import { planVideoQuestion } from './query-planner';
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
  /**
   * Every indexed chapter as one chronological line -- timecodes and a short
   * title, no summaries. This is the navigational map a model can afford to
   * carry on every question; `chapters`/`scenes` above hold the detail for
   * when it deliberately asks for it.
   */
  timeline: Array<{ startSecs: number; endSecs: number; title: string }>;
  coverage: {
    mode: 'focused' | 'broad';
    totalChapters: number;
    totalScenes: number;
    representedRanges: number;
  };
  strategy: 'answer-from-evidence' | 'inspect-candidate-ranges' | 'establish-broad-context';
}

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

function evenlySpaced<T>(items: T[], limit: number): T[] {
  if (items.length <= limit) return items;
  if (limit <= 1) return [items[0]];
  const selected: T[] = [];
  for (let index = 0; index < limit; index += 1) {
    selected.push(items[Math.round((index * (items.length - 1)) / (limit - 1))]);
  }
  return selected;
}

/**
 * A one-line label for a timecode. Indexing writes titles that repeat the
 * position ("Chapter 3: Scene 12:"), lead with a frame detector's track list,
 * or embed a serialized payload -- none of which help anyone decide whether to
 * look at that part of the source. Whitespace is flattened first so these
 * patterns are recognizable in a title that spans several lines.
 */
function timelineTitle(title: string): string {
  const cleaned = title
    .replace(/\s+/g, ' ')
    .replace(/^(?:Chapter\s*\d+\s*:\s*)?(?:Scene\s*\d+\s*:\s*)?/i, '')
    .replace(/Detected objects:[^{]*/gi, '')
    .replace(/\{[\s\S]*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 90);
}

function compactRange(node: VideoHierarchyNode) {
  const duration = node.timeRange.endSecs - node.timeRange.startSecs;
  if (duration <= 60) return { ...node.timeRange, reason: node.title };
  const midpoint = node.timeRange.startSecs + duration / 2;
  return {
    startSecs: Math.max(node.timeRange.startSecs, midpoint - 30),
    endSecs: Math.min(node.timeRange.endSecs, midpoint + 30),
    precision: node.timeRange.precision,
    reason: node.title,
  };
}

/**
 * Builds a compact temporal tree for every question. Language models decide
 * what to inspect, but never invent ranges that are absent from the active
 * revision. This deliberately reads current state on every request while
 * video-analysis caching is disabled.
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
  const terms = termsFor(question);
  const queryPlan = planVideoQuestion(question);
  const broadCoverage = queryPlan.requiresBroadCoverage;
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
  // Evidence is activated across a revision's whole ancestry (the manifest
  // names an active record per lineage), but the chapter/scene/event/state
  // hierarchy is written per revision. Filtering it to the active revision
  // alone means one bounded refinement -- which produces a handful of nodes
  // for the range it looked at -- replaces the entire map of the source, and
  // the model is left navigating a fifty-minute recording by three chapters.
  // Accept the whole lineage, newest revision winning where they overlap.
  const lineage = new Set<string>();
  for (
    let current: (typeof state.revisions)[number] | undefined = state.revisions.find(
      (revision) => revision.id === revisionId,
    );
    current && !lineage.has(current.id);

  ) {
    lineage.add(current.id);
    const parentId: string | undefined = current.parentRevisionId;
    current = parentId ? state.revisions.find((revision) => revision.id === parentId) : undefined;
  }
  if (lineage.size === 0) lineage.add(revisionId);
  const inLineage = (item: { mediaAssetId: string; knowledgeRevisionId: string }) =>
    item.mediaAssetId === mediaAssetId && lineage.has(item.knowledgeRevisionId);

  const allScenes = state.scenes.filter(inLineage).map((item) => {
    const summary = evidenceText(item.evidenceLineageIds).slice(0, 700);
    return {
      id: item.id,
      title: item.title,
      summary,
      timeRange: item.timeRange,
      evidenceCount: item.evidenceLineageIds.length,
      score: scoreText(`${item.title}\n${summary}`, terms),
    };
  });
  const scenes = take([...allScenes], broadCoverage ? 32 : 8);
  const allChapters = state.chapters.filter(inLineage).map((item) => {
    const summary = evidenceText(item.evidenceLineageIds).slice(0, 900);
    return {
      id: item.id,
      title: item.title,
      summary,
      timeRange: item.timeRange,
      evidenceCount: item.evidenceLineageIds.length,
      score: scoreText(`${item.title}\n${summary}`, terms),
    };
  });
  const chapters = take([...allChapters], broadCoverage ? 24 : 4);
  const events = take(
    state.events.filter(inLineage).map((item) => ({
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
    state.states.filter(inLineage).map((item) => ({
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
  const focusedRanges = ranked.slice(0, broadCoverage ? 6 : 6).map(compactRange);
  const coverageAnchors = broadCoverage
    ? evenlySpaced(
        [...allScenes].sort((left, right) => left.timeRange.startSecs - right.timeRange.startSecs),
        8,
      ).map(compactRange)
    : [];
  const candidateRanges = [...focusedRanges, ...coverageAnchors]
    .filter(
      (candidate, index, ranges) =>
        ranges.findIndex(
          (range) =>
            Math.abs(range.startSecs - candidate.startSecs) < 10 &&
            Math.abs(range.endSecs - candidate.endSecs) < 10,
        ) === index,
    )
    .slice(0, broadCoverage ? 10 : 6);
  const value: VideoInvestigationPlan = {
    mediaAssetId,
    knowledgeRevisionId: revisionId,
    question,
    chapters,
    scenes,
    events,
    states,
    candidateRanges,
    timeline: [...allChapters]
      .sort((left, right) => left.timeRange.startSecs - right.timeRange.startSecs)
      .slice(0, 24)
      .map((chapter) => ({
        startSecs: chapter.timeRange.startSecs,
        endSecs: chapter.timeRange.endSecs,
        title: timelineTitle(chapter.title),
      }))
      .filter((entry) => entry.title.length > 0),
    coverage: {
      mode: broadCoverage ? 'broad' : 'focused',
      totalChapters: allChapters.length,
      totalScenes: allScenes.length,
      representedRanges: candidateRanges.length,
    },
    strategy:
      broadCoverage && (chapters.length > 0 || scenes.length > 0)
        ? 'establish-broad-context'
        : candidateRanges.length > 0
        ? 'answer-from-evidence'
        : chapters.length > 0 || scenes.length > 0
        ? 'establish-broad-context'
        : 'inspect-candidate-ranges',
  };
  return value;
}
