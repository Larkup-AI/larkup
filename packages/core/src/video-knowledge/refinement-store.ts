import {
  createVideoKnowledgeRevision,
  getVideoKnowledgeRevision,
  updateVideoKnowledgeRevision,
} from './revision-store';
import {
  buildVideoKnowledgeFromEvidence,
  type OfflineKnowledgeEvidenceInput,
} from './knowledge-builder';
import { activateVideoKnowledgeManifest, getActiveVideoKnowledgeManifest } from './manifest-store';

export interface AppendVideoKnowledgeRefinementInput {
  mediaAssetId: string;
  /** The source-backed additions produced by a bounded inspection or approved analysis. */
  evidence: OfflineKnowledgeEvidenceInput[];
  activationReason?: 'retry' | 'model-upgrade' | 'manual-review' | 'query-refinement';
}

/**
 * Adds useful new source knowledge without mutating or discarding an active
 * revision. The new manifest contains the previous active evidence plus the
 * appended evidence, so a failed refinement can never make older citations
 * disappear.
 */
export async function appendVideoKnowledgeRefinement(input: AppendVideoKnowledgeRefinementInput) {
  if (input.evidence.length === 0)
    throw new Error('A refinement needs at least one evidence artifact.');
  const activeManifest = await getActiveVideoKnowledgeManifest(input.mediaAssetId);
  if (!activeManifest)
    throw new Error('Cannot refine media without an active video knowledge revision.');
  const parent = await getVideoKnowledgeRevision(activeManifest.knowledgeRevisionId);
  if (!parent) throw new Error('The active video knowledge revision no longer exists.');
  const revision = await createVideoKnowledgeRevision({
    mediaAssetId: input.mediaAssetId,
    parentRevisionId: parent.id,
    sourceFingerprint: parent.sourceFingerprint,
    pipelineVersion: parent.pipelineVersion,
    guidance: parent.guidance,
    budget: parent.budget,
    coverage: parent.coverage,
  });
  try {
    const built = await buildVideoKnowledgeFromEvidence({
      mediaAssetId: input.mediaAssetId,
      knowledgeRevisionId: revision.id,
      evidence: input.evidence,
    });
    const manifest = await activateVideoKnowledgeManifest({
      mediaAssetId: input.mediaAssetId,
      knowledgeRevisionId: revision.id,
      activeEvidenceRevisionIds: {
        ...activeManifest.activeEvidenceRevisionIds,
        ...Object.fromEntries(
          built.evidenceLineageIds.map((lineageId, index) => [lineageId, built.evidenceIds[index]]),
        ),
      },
      activeObservationRevisionIds: {
        ...activeManifest.activeObservationRevisionIds,
        ...Object.fromEntries(
          built.observationLineageIds.map((lineageId, index) => [
            lineageId,
            built.observationIds[index],
          ]),
        ),
      },
      // Refinements without indexed projection documents keep previously active
      // projections active; evidence-first retrieval sees the appended source.
      activeProjectionIds: activeManifest.activeProjectionIds,
      activationReason: input.activationReason ?? 'query-refinement',
    });
    await updateVideoKnowledgeRevision(revision.id, {
      status: 'completed',
      activeManifestId: manifest.id,
      completedAt: new Date().toISOString(),
    });
    return { revision, manifest, built };
  } catch (error) {
    await updateVideoKnowledgeRevision(revision.id, { status: 'failed' }).catch(() => {});
    throw error;
  }
}
