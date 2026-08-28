import { readVideoKnowledgeState } from './store';

export interface ExpandedRange {
  mediaAssetId: string;
  requested: { startSecs: number; endSecs: number };
  expanded: { startSecs: number; endSecs: number };
  basis: 'scene' | 'chapter' | 'padding' | 'unchanged';
  reason: string;
}

const PADDING_SECS = 30;

/**
 * Widens an investigation range for the agentic loop's expand_range tool.
 *
 * Prefers the smallest indexed scene/chapter that fully contains the
 * requested range -- a structural boundary the video itself already has --
 * over an arbitrary fixed pad, so a widened range still lines up with a
 * coherent unit the agent can reason about. Falls back to a fixed pad only
 * when no such boundary exists (e.g. before any full index has completed).
 */
export async function expandInvestigationRange(
  mediaAssetId: string,
  range: { startSecs: number; endSecs: number },
  videoDurationSecs?: number,
): Promise<ExpandedRange | undefined> {
  const state = await readVideoKnowledgeState();
  const manifest = state.manifests
    .filter((item) => item.mediaAssetId === mediaAssetId && item.activatedAt)
    .sort((left, right) => right.activatedAt!.localeCompare(left.activatedAt!))[0];
  if (!manifest) return undefined;
  const revisionId = manifest.knowledgeRevisionId;

  const contains = (candidate: { startSecs: number; endSecs: number }) =>
    candidate.startSecs <= range.startSecs && candidate.endSecs >= range.endSecs;
  const width = (candidate: { startSecs: number; endSecs: number }) =>
    candidate.endSecs - candidate.startSecs;

  const scenes = state.scenes.filter(
    (item) =>
      item.mediaAssetId === mediaAssetId &&
      item.knowledgeRevisionId === revisionId &&
      contains(item.timeRange) &&
      width(item.timeRange) > width(range),
  );
  const chapters = state.chapters.filter(
    (item) =>
      item.mediaAssetId === mediaAssetId &&
      item.knowledgeRevisionId === revisionId &&
      contains(item.timeRange) &&
      width(item.timeRange) > width(range),
  );

  const smallestScene = scenes.sort((left, right) => width(left.timeRange) - width(right.timeRange))[0];
  if (smallestScene) {
    return {
      mediaAssetId,
      requested: range,
      expanded: {
        startSecs: smallestScene.timeRange.startSecs,
        endSecs: smallestScene.timeRange.endSecs,
      },
      basis: 'scene',
      reason: `Expanded to the enclosing scene "${smallestScene.title}".`,
    };
  }

  const smallestChapter = chapters.sort(
    (left, right) => width(left.timeRange) - width(right.timeRange),
  )[0];
  if (smallestChapter) {
    return {
      mediaAssetId,
      requested: range,
      expanded: {
        startSecs: smallestChapter.timeRange.startSecs,
        endSecs: smallestChapter.timeRange.endSecs,
      },
      basis: 'chapter',
      reason: `Expanded to the enclosing chapter "${smallestChapter.title}".`,
    };
  }

  const padded = {
    startSecs: Math.max(0, range.startSecs - PADDING_SECS),
    endSecs:
      videoDurationSecs !== undefined
        ? Math.min(videoDurationSecs, range.endSecs + PADDING_SECS)
        : range.endSecs + PADDING_SECS,
  };
  if (padded.startSecs === range.startSecs && padded.endSecs === range.endSecs) {
    return {
      mediaAssetId,
      requested: range,
      expanded: padded,
      basis: 'unchanged',
      reason: 'Already at the source boundary; the range could not be expanded further.',
    };
  }
  return {
    mediaAssetId,
    requested: range,
    expanded: padded,
    basis: 'padding',
    reason: `No enclosing scene or chapter is indexed yet; padded by ${PADDING_SECS}s on each side.`,
  };
}
