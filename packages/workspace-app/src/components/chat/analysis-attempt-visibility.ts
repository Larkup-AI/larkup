// Decide which analysis (code-execution) attempts to show in the transcript.
// The planner may retry a failed analysis within a single assistant turn; only
// the final attempt should be visible, so a failed attempt is hidden whenever a
// later attempt exists — whether it is still running or already completed. If
// every attempt fails, the last one is still shown. Pure and dependency-free so
// it can be unit-tested without the chat message component.

export interface AnalysisAttemptState {
  /** Whether this tool part is an analysis (code-execution) attempt. */
  isAnalysisAttempt: boolean;
  /** Whether this analysis attempt failed (errored or exited non-zero). */
  isFailure: boolean;
}

/**
 * True when the attempt at `index` is a failed analysis attempt that a later
 * attempt supersedes, so it should be hidden from the user.
 */
export function isSupersededAnalysisFailure(parts: AnalysisAttemptState[], index: number): boolean {
  const part = parts[index];
  if (!part?.isAnalysisAttempt || !part.isFailure) return false;
  for (let i = index + 1; i < parts.length; i += 1) {
    if (parts[i]?.isAnalysisAttempt) return true;
  }
  return false;
}
