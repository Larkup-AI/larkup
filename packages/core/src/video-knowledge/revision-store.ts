import { randomUUID } from 'node:crypto';
import { mutateVideoKnowledgeState, readVideoKnowledgeState } from './store';
import type { VideoKnowledgeRevision, VideoBudget, KnowledgeCoverage } from './types';

export interface CreateVideoKnowledgeRevisionInput {
  mediaAssetId: string;
  sourceFingerprint: string;
  pipelineVersion: string;
  parentRevisionId?: string;
  guidance?: VideoKnowledgeRevision['guidance'];
  budget: VideoBudget;
  coverage: KnowledgeCoverage;
}

export function createVideoKnowledgeRevision(input: CreateVideoKnowledgeRevisionInput) {
  return mutateVideoKnowledgeState((state) => {
    const now = new Date().toISOString();
    const revision: VideoKnowledgeRevision = {
      id: randomUUID(),
      mediaAssetId: input.mediaAssetId,
      sourceFingerprint: input.sourceFingerprint,
      pipelineVersion: input.pipelineVersion,
      parentRevisionId: input.parentRevisionId,
      guidance: input.guidance,
      status: 'queued',
      budget: input.budget,
      coverage: input.coverage,
      schemaVersion: 1,
      createdAt: now,
    };
    state.revisions.push(revision);
    return revision;
  });
}

export async function getVideoKnowledgeRevision(id: string) {
  return (await readVideoKnowledgeState()).revisions.find((revision) => revision.id === id);
}

export async function listVideoKnowledgeRevisions(mediaAssetId: string) {
  return (await readVideoKnowledgeState()).revisions.filter(
    (revision) => revision.mediaAssetId === mediaAssetId,
  );
}

export async function findVideoKnowledgeRevision(
  mediaAssetId: string,
  sourceFingerprint: string,
  pipelineVersion: string,
) {
  return (await readVideoKnowledgeState()).revisions
    .filter(
      (revision) =>
        revision.mediaAssetId === mediaAssetId &&
        revision.sourceFingerprint === sourceFingerprint &&
        revision.pipelineVersion === pipelineVersion,
    )
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

export function updateVideoKnowledgeRevision(
  id: string,
  patch: Partial<
    Pick<
      VideoKnowledgeRevision,
      'status' | 'coverage' | 'budget' | 'activeManifestId' | 'completedAt'
    >
  >,
) {
  return mutateVideoKnowledgeState((state) => {
    const index = state.revisions.findIndex((revision) => revision.id === id);
    if (index < 0) return undefined;
    const completedAt =
      patch.status === 'completed' || patch.status === 'partially_failed'
        ? patch.completedAt ?? state.revisions[index].completedAt ?? new Date().toISOString()
        : patch.completedAt;
    state.revisions[index] = { ...state.revisions[index], ...patch, completedAt };
    return state.revisions[index];
  });
}
