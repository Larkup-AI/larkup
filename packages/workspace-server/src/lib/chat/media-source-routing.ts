import { buildQueryTermMatchers, countMatchesIn } from './retrieval-ranking';

export type RoutableMediaAsset = {
  id: string;
  fileName: string;
  originalUrl?: string;
  processingStatus: string;
  activeVideoKnowledgeRevisionId?: string;
  type: string;
  documentIds: string[];
};

/** Select a title only when it has a clear lexical lead over every other source. */
export function clearlyTitleMatchedMediaAsset<T extends RoutableMediaAsset>(
  query: string,
  assets: readonly T[],
): T | undefined {
  const matchers = buildQueryTermMatchers(query);
  if (matchers.length === 0) return undefined;
  const ranked = assets
    .map((asset) => ({ asset, matches: countMatchesIn(matchers, asset.fileName) }))
    .filter(({ matches }) => matches >= Math.min(2, matchers.length))
    .sort((left, right) => right.matches - left.matches);
  if (ranked.length === 0) return undefined;
  if (ranked.length > 1 && ranked[0].matches === ranked[1].matches) return undefined;
  return ranked[0].asset;
}

/**
 * Before ordinary retrieval runs, media may become authoritative only when
 * the question explicitly names it. A sole video is a safe fallback after a
 * retrieval miss, but it must never pre-empt a document or tabular hit.
 */
export function explicitlySelectedMediaAsset<T extends RoutableMediaAsset>(
  query: string,
  assets: readonly T[],
): T | undefined {
  return clearlyTitleMatchedMediaAsset(query, assets);
}

/**
 * Detect an explicitly named source that exists but is outside the Assistant
 * source scope. A generic single-source fallback must not silently replace it
 * with an unrelated enabled recording.
 */
export function clearlyUnavailableTitleMatchedMediaAsset<T extends RoutableMediaAsset>(
  query: string,
  availableAssets: readonly T[],
  allAssets: readonly T[],
): T | undefined {
  const matched = clearlyTitleMatchedMediaAsset(query, allAssets);
  if (!matched) return undefined;
  return availableAssets.some((asset) => asset.id === matched.id) ? undefined : matched;
}

/**
 * A conversation carries a source selection as structured state. Once a
 * source is selected, do not reinterpret ordinary user prose in an attempt
 * to switch it: that is language- and genre-dependent, and can silently send
 * a precise question to a different recording. A source switch must be
 * represented by a new selected source in the conversation.
 */
export function shouldKeepActiveMediaSource<T extends RoutableMediaAsset>(
  _query: string,
  activeAsset: T,
  availableAssets: readonly T[],
) {
  return availableAssets.some((asset) => asset.id === activeAsset.id);
}

/** A conversational follow-up stays on its active source and skips global reranking. */
export function activeMediaFollowUpResult(
  query: string,
  asset: RoutableMediaAsset,
  indexedContext?: string,
) {
  const context = indexedContext?.trim();
  return {
    query,
    hits: [
      {
        title: asset.fileName,
        url: `/api/media/${encodeURIComponent(asset.id)}`,
        score: 1,
        text: context ?? '',
        ...(context ? { context } : {}),
        metadata: {
          mediaAssetId: asset.id,
          mediaType: asset.type,
          fileName: asset.fileName,
        },
      },
    ],
    videoEvidence: {
      mediaAssetId: asset.id,
      fileName: asset.fileName,
      retrievalFallback: 'active-conversation-media-source' as const,
    },
  };
}
