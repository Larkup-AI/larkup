import { mutateVideoKnowledgeState } from './store';

/** Remove every durable video-knowledge record scoped to a deleted MediaAsset. */
export function deleteVideoKnowledgeForMediaAsset(mediaAssetId: string) {
  return mutateVideoKnowledgeState((state) => {
    const before = {
      revisions: state.revisions.length,
      jobs: state.jobs.length,
      artifacts: state.artifacts.length,
      evidence: state.evidence.length,
      observations: state.observations.length,
      states: state.states.length,
      transitions: state.transitions.length,
      events: state.events.length,
      scenes: state.scenes.length,
      chapters: state.chapters.length,
      summaries: state.summaries.length,
      derived: state.derived.length,
      conflicts: state.conflicts.length,
      manifests: state.manifests.length,
      projections: state.projections.length,
      inspectionReservations: state.inspectionReservations.length,
      backgroundRefinements: state.backgroundRefinements.length,
      artifactAnalysisCache: state.artifactAnalysisCache.length,
      answerMemory: state.answerMemory.length,
    };
    for (const key of Object.keys(before) as Array<keyof typeof before>) {
      const records = state[key] as Array<{ mediaAssetId: string }>;
      (state[key] as unknown) = records.filter((record) => record.mediaAssetId !== mediaAssetId);
    }
    return Object.fromEntries(
      Object.entries(before).map(([key, count]) => [
        key,
        count - (state[key as keyof typeof before] as unknown as unknown[]).length,
      ]),
    );
  });
}
