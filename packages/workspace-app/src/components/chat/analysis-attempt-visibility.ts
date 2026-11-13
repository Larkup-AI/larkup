// Decide which analysis (code-execution) attempts to show in the transcript.
// A failed analysis attempt is an internal diagnostic, not user-facing content:
// it is always hidden, whether the planner retried, succeeded later, or gave up.
// The assistant's own message conveys the outcome to the user, and successful
// analysis results (tables, charts) are still shown. Pure and dependency-free so
// it can be unit-tested without the chat message component.

export interface AnalysisAttemptState {
  /** Whether this tool part is an analysis (code-execution) attempt. */
  isAnalysisAttempt: boolean;
  /** Whether this analysis attempt failed (errored or exited non-zero). */
  isFailure: boolean;
}

/** True when a part is a failed analysis attempt that should be hidden. */
export function isHiddenAnalysisFailure(part: AnalysisAttemptState | undefined): boolean {
  return Boolean(part?.isAnalysisAttempt && part.isFailure);
}
