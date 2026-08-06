import { mutateVideoKnowledgeState, readVideoKnowledgeState } from './store';
import type { MetadataValue } from './types';

/** Read a durable, source-scoped analysis result without exposing an artifact path. */
export async function getCachedArtifactAnalysis(
  mediaAssetId: string,
  key: string,
): Promise<MetadataValue | undefined> {
  return (await readVideoKnowledgeState()).artifactAnalysisCache.find(
    (entry) => entry.mediaAssetId === mediaAssetId && entry.key === key,
  )?.value;
}

/** Upsert one validated analyzer output. Keys are derived without secrets or paths. */
export function saveCachedArtifactAnalysis(input: {
  key: string;
  mediaAssetId: string;
  knowledgeRevisionId: string;
  operation: string;
  value: MetadataValue;
}) {
  return mutateVideoKnowledgeState((state) => {
    const existing = state.artifactAnalysisCache.find(
      (entry) => entry.mediaAssetId === input.mediaAssetId && entry.key === input.key,
    );
    if (existing) {
      existing.value = input.value;
      existing.knowledgeRevisionId = input.knowledgeRevisionId;
      return existing;
    }
    const entry = { ...input, createdAt: new Date().toISOString() };
    state.artifactAnalysisCache.push(entry);
    return entry;
  });
}
