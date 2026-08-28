export interface FrameCandidate {
  path: string;
  timestampSecs: number;
  /** 0–1 normalized cheap signals collected during extraction. */
  signals: {
    shotChange?: number;
    perceptualChange?: number;
    transcriptChange?: number;
    ocrChange?: number;
    motionChange?: number;
    guidanceRelevance?: number;
  };
  protected?: boolean;
}

export interface FrameSelection {
  candidate: FrameCandidate;
  score: number;
  decision: 'retained' | 'dropped' | 'protected';
  reason: string;
}

const clamp = (value: number | undefined) => Math.max(0, Math.min(1, value ?? 0));

/**
 * Retains candidate frames only when they add deterministic information or
 * protect a maximum coverage gap. Model analysis happens after this gate.
 */
export function selectFramesByInformationGain(
  candidates: FrameCandidate[],
  options: { maxFrames: number; maximumCoverageGapSecs: number; threshold?: number },
): FrameSelection[] {
  const kept: FrameSelection[] = [];
  const threshold = options.threshold ?? 0.35;
  let previousTimestamp = Number.NEGATIVE_INFINITY;
  return [...candidates]
    .sort((left, right) => left.timestampSecs - right.timestampSecs)
    .map((candidate) => {
      const gapProtected =
        candidate.timestampSecs - previousTimestamp >= options.maximumCoverageGapSecs;
      const score =
        clamp(candidate.signals.shotChange) * 0.25 +
        clamp(candidate.signals.perceptualChange) * 0.2 +
        clamp(candidate.signals.transcriptChange) * 0.2 +
        clamp(candidate.signals.ocrChange) * 0.2 +
        clamp(candidate.signals.motionChange) * 0.1 +
        clamp(candidate.signals.guidanceRelevance) * 0.05;
      const protectedFrame = Boolean(candidate.protected || gapProtected);
      // Coverage candidates are important, but they cannot bypass the job's
      // declared hard frame budget. The caller can raise the budget or create
      // a refinement when the requested coverage needs more frames.
      const hasCapacity = kept.length < Math.max(0, options.maxFrames);
      const retain = hasCapacity && (protectedFrame || score >= threshold);
      const selection: FrameSelection = {
        candidate,
        score,
        decision: retain && protectedFrame ? 'protected' : retain ? 'retained' : 'dropped',
        reason:
          retain && protectedFrame
            ? candidate.protected
              ? 'protected-source-range'
              : 'coverage-gap'
            : retain
            ? 'information-gain'
            : hasCapacity
            ? 'insufficient-information-gain'
            : 'max-frame-budget',
      };
      if (retain) {
        kept.push(selection);
        previousTimestamp = candidate.timestampSecs;
      }
      return selection;
    });
}
