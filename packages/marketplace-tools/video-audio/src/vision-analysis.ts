export type VisualObservationKind = 'object' | 'action' | 'ui' | 'chart' | 'relationship' | 'state';

export interface VisualObservationCandidate {
  kind: VisualObservationKind;
  value: string;
  frameTimestamps: number[];
  confidence: number;
  uncertaintyReasons: string[];
}

export interface VisionAnalysisAdapter {
  analyze(input: {
    frames: Array<{ path: string; timestampSecs: number }>;
    previousContext?: string;
    signal?: AbortSignal;
  }): Promise<{ observations: VisualObservationCandidate[] }>;
}

export function validateVisualObservations(observations: VisualObservationCandidate[]) {
  return observations.filter(
    (item) =>
      item.value.trim().length > 0 &&
      item.frameTimestamps.length > 0 &&
      Number.isFinite(item.confidence) &&
      item.confidence >= 0 &&
      item.confidence <= 1,
  );
}
