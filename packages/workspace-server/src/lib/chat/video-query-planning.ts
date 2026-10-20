import type { VideoInvestigationDirective } from '@larkup/core/video-knowledge/query-planner';

export interface VideoQuestionSignals {
  hasPosition?: boolean;
  connectsBeyondPosition?: boolean;
  asksForSettledOutcome?: boolean;
}

/**
 * Reconcile the planner directive with the independent question classifier.
 * The classifier is deliberately language-neutral and has final authority over
 * outcome requests, because a broad planner can otherwise mistake “who won?”
 * for source synthesis and send the answer through appearance rendering.
 */
export function reconcileVideoInvestigation(
  planned: VideoInvestigationDirective | undefined,
  signals: VideoQuestionSignals | undefined,
): VideoInvestigationDirective | undefined {
  if (signals?.asksForSettledOutcome) {
    return { scope: 'temporal', goal: 'resolve' };
  }
  if (signals?.hasPosition === false && planned?.timeRange) {
    return { scope: 'source', goal: 'synthesize' };
  }
  if ((signals?.connectsBeyondPosition || planned?.goal === 'trace') && planned?.timeRange) {
    return {
      ...planned,
      scope: 'temporal',
      goal: 'trace',
      evidence: ['visual'],
      recordSet: 'observed',
    };
  }
  return planned;
}
