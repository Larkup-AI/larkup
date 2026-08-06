/** Deterministic, bounded information-gain scoring for media candidates. */
export interface FrameCandidateSignals {
  timestampSecs: number;
  shotChange?: number;
  perceptualChange?: number;
  transcriptChange?: number;
  ocrChange?: number;
  motionChange?: number;
  guidanceRelevance?: number;
  secondsSinceAccepted?: number;
  protected?: boolean;
}

export interface InformationGainDecision {
  timestampSecs: number;
  score: number;
  decision: 'retained' | 'dropped' | 'protected';
  reasons: string[];
}

const clamp = (value: number | undefined) => Math.max(0, Math.min(1, value ?? 0));

/**
 * Scores candidates without model judgement. Protected and coverage candidates
 * always survive; all other candidates need a measurable source change.
 */
export function selectInformationGainCandidates(
  candidates: FrameCandidateSignals[],
  options: { minimumCoverageSecs: number; threshold?: number; maxFrames: number },
): InformationGainDecision[] {
  const threshold = options.threshold ?? 0.35;
  const selected: InformationGainDecision[] = [];
  for (const candidate of [...candidates].sort((a, b) => a.timestampSecs - b.timestampSecs)) {
    const coverageRequired =
      (candidate.secondsSinceAccepted ?? Infinity) >= options.minimumCoverageSecs;
    const score =
      clamp(candidate.shotChange) * 0.24 +
      clamp(candidate.perceptualChange) * 0.18 +
      clamp(candidate.transcriptChange) * 0.2 +
      clamp(candidate.ocrChange) * 0.2 +
      clamp(candidate.motionChange) * 0.1 +
      clamp(candidate.guidanceRelevance) * 0.08;
    const protectedCandidate = Boolean(candidate.protected || coverageRequired);
    selected.push({
      timestampSecs: candidate.timestampSecs,
      score,
      decision: protectedCandidate
        ? 'protected'
        : score >= threshold &&
          selected.filter((item) => item.decision !== 'dropped').length < options.maxFrames
        ? 'retained'
        : 'dropped',
      reasons: protectedCandidate
        ? [candidate.protected ? 'protected-range' : 'coverage-gap']
        : score >= threshold
        ? ['information-gain']
        : ['insufficient-information-gain'],
    });
  }
  return selected;
}
