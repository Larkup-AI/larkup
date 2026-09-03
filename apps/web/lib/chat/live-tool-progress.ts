export type LiveToolActivity = {
  toolCallId?: string;
  phase?: 'waking-up' | 'analyzing';
  percent: number;
  label: string;
  message: string;
  startedAt?: string;
  updatedAt?: string;
};

/**
 * A worker reports 100% when *its* pass is done, but the chat turn is not:
 * the evidence still has to be validated, stored, activated, and re-queried,
 * and a second range may follow. Showing a full bar through all of that reads
 * as a hang, so a running tool call never displays a completed bar -- the row
 * disappears when the call actually returns.
 */
export const RUNNING_PROGRESS_CEILING = 97;

/** Past this the bar stops claiming a position and just shows motion. */
export const INDETERMINATE_THRESHOLD = 90;

/** A tool can be working through local indexed context before a worker exists. */
export const PENDING_PROGRESS_CEILING = 82;

/**
 * Give every executing tool visible motion immediately, even before it has a
 * worker percentage to report. This is deliberately time-based UX, not a
 * completion estimate; authoritative activity replaces it as soon as one is
 * available and only the tool result removes the row.
 */
export function smoothPendingToolProgress(startedAt: number, now = Date.now()) {
  const elapsedMs = Math.max(0, now - startedAt);
  const initial = 4;
  const estimated =
    initial + (PENDING_PROGRESS_CEILING - initial) * (1 - Math.exp(-elapsedMs / 55_000));
  return Math.max(initial, Math.min(PENDING_PROGRESS_CEILING, estimated));
}

/**
 * Cloud workers publish real stage boundaries, not a progress event for every
 * second of GPU work. Keep the bar alive between those events without
 * pretending the job is complete: the estimate asymptotically approaches a
 * pre-completion ceiling and an actual worker update always wins.
 */
export function smoothLiveToolProgress(activity: LiveToolActivity, now = Date.now()) {
  const reported = Math.max(0, Math.min(RUNNING_PROGRESS_CEILING, activity.percent));
  const changedAt = Date.parse(activity.updatedAt ?? activity.startedAt ?? '');
  if (!Number.isFinite(changedAt)) return reported;
  const elapsedMs = Math.max(0, now - changedAt);
  const ceiling = activity.phase === 'waking-up' ? 28 : RUNNING_PROGRESS_CEILING;
  if (reported >= ceiling) return reported;
  const estimated = reported + (ceiling - reported) * (1 - Math.exp(-elapsedMs / 75_000));
  return Math.round(Math.max(reported, Math.min(ceiling, estimated)));
}

/** A consecutive bounded source read belongs to the same chat tool call. */
export function keepToolProgressMonotonic(previous: number | undefined, current: number) {
  return Math.min(RUNNING_PROGRESS_CEILING, Math.max(previous ?? 0, current));
}

/**
 * Near the ceiling the remaining work has no measurable position -- the bar
 * would sit still while real work continues. Swing it instead: motion without
 * a false claim about how much is left.
 */
export function isIndeterminateProgress(percent: number) {
  return percent >= INDETERMINATE_THRESHOLD;
}
