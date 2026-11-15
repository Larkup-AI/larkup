/** Presentation helpers. Pure functions shared by client components. */
import type { RunState } from './contract.js';

/** ms -> short human duration. null/undefined -> em dash marker. */
export function fmtDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)} s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  if (m < 60) return `${m}m ${rem}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/** decimal money string + currency; null -> explicit unknown. */
export function fmtMoney(amount: string | null | undefined, currency = 'USD'): string {
  if (amount === null || amount === undefined) return 'unknown';
  return `${currency} ${amount}`;
}

/** accuracy as percentage WITH denominator; never coerces null to 0. */
export function fmtAccuracy(accuracy: number | null, denominator: number): string {
  if (accuracy === null) return denominator === 0 ? 'no data' : '—';
  return `${(accuracy * 100).toFixed(1)}%`;
}

export function fmtPercent(n: number | null | undefined): string {
  if (n === null || n === undefined) return 'indeterminate';
  return `${Math.round(n)}%`;
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { hour12: false });
  } catch {
    return iso;
  }
}

export function relTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diff = Date.now() - then;
  const abs = Math.abs(diff);
  const units: Array<[number, string]> = [
    [86400000, 'd'],
    [3600000, 'h'],
    [60000, 'm'],
    [1000, 's'],
  ];
  for (const [ms, label] of units) {
    if (abs >= ms) return `${Math.round(diff / ms)}${label} ago`.replace('-', 'in ');
  }
  return 'just now';
}

export const STATE_TONE: Record<RunState, 'go' | 'wait' | 'warn' | 'bad' | 'done' | 'idle'> = {
  draft: 'idle',
  running: 'go',
  pausing: 'wait',
  paused: 'wait',
  blocked: 'warn',
  cancelling: 'wait',
  cancelled: 'bad',
  completed: 'done',
  failed: 'bad',
};

/** Which controls are enabled in a given run state (client-side affordance only;
 *  the controller remains authoritative and may still reject with 409). */
export function allowedControls(state: RunState): Array<'start' | 'pause' | 'resume' | 'cancel'> {
  switch (state) {
    case 'draft':
      return ['start'];
    case 'running':
      return ['pause', 'cancel'];
    case 'pausing':
      return ['resume', 'cancel'];
    case 'paused':
      return ['resume', 'cancel'];
    case 'blocked':
      return ['cancel'];
    default:
      return [];
  }
}

/** Generate an idempotency key for a control click (one per intent). */
export function newIdempotencyKey(op: string, runId: string, revision: string): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : String(Math.random()).slice(2);
  return `${op}-${runId}-r${revision}-${rand}`;
}
