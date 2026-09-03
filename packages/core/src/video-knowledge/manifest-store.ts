import { randomUUID } from 'node:crypto';
import { mutateVideoKnowledgeState, readVideoKnowledgeState } from './store';
import type { ActiveRevisionManifest, VideoKnowledgeProjection } from './types';

export function saveVideoKnowledgeProjection(
  record: Omit<VideoKnowledgeProjection, 'id' | 'schemaVersion' | 'createdAt'>,
) {
  return saveVideoKnowledgeProjections([record]).then(([projection]) => projection);
}

/**
 * Persists a publication's projections in one atomic write. Video indexing can
 * produce hundreds of projections, so one write per projection leaves the
 * asset stuck at 100% while repeatedly serializing the same evidence store.
 */
export function saveVideoKnowledgeProjections(
  records: Array<Omit<VideoKnowledgeProjection, 'id' | 'schemaVersion' | 'createdAt'>>,
) {
  return mutateVideoKnowledgeState((state) => {
    const createdAt = new Date().toISOString();
    const projections = records.map(
      (record): VideoKnowledgeProjection => ({
        ...record,
        id: randomUUID(),
        schemaVersion: 1,
        createdAt,
      }),
    );
    state.projections.push(...projections);
    return projections;
  });
}

/** Atomically switches the active projections for an asset/revision. */
export function activateVideoKnowledgeManifest(
  input: Omit<ActiveRevisionManifest, 'id' | 'schemaVersion' | 'createdAt' | 'activatedAt'>,
) {
  return mutateVideoKnowledgeState((state) => {
    const now = new Date().toISOString();
    for (const projection of state.projections) {
      if (projection.mediaAssetId === input.mediaAssetId)
        projection.active = input.activeProjectionIds.includes(projection.id);
    }
    const manifest: ActiveRevisionManifest = {
      ...input,
      id: randomUUID(),
      schemaVersion: 1,
      createdAt: now,
      activatedAt: now,
    };
    state.manifests.push(manifest);
    const revision = state.revisions.find(
      (candidate) => candidate.id === input.knowledgeRevisionId,
    );
    if (revision) revision.activeManifestId = manifest.id;
    return manifest;
  });
}

export async function getActiveVideoKnowledgeManifest(mediaAssetId: string) {
  return (await readVideoKnowledgeState()).manifests
    .filter((manifest) => manifest.mediaAssetId === mediaAssetId && manifest.activatedAt)
    .sort((a, b) => b.activatedAt!.localeCompare(a.activatedAt!))[0];
}
