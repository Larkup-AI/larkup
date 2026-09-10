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
 * A prior clip is a useful conversational default only when it is the sole
 * completed source or the new wording clearly repeats that clip's title.
 * Otherwise retrieval must get a chance to select another indexed video.
 */
export function shouldKeepActiveMediaSource<T extends RoutableMediaAsset>(
  query: string,
  activeAsset: T,
  availableAssets: readonly T[],
) {
  return (
    availableAssets.length <= 1 ||
    clearlyTitleMatchedMediaAsset(query, availableAssets)?.id === activeAsset.id
  );
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
