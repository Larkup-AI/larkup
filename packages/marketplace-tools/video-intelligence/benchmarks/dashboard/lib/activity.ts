import type { RunState, TaskObject, VariantSummary } from './contract.js';

type Activity = { label: string; tone: 'go' | 'warn' | 'bad' | 'idle'; pulse: boolean };
const ACTIVE = ['leased', 'submitted', 'running'];

export function providerActivity({
  row,
  runState,
  live,
  tasks,
  queueLabel,
}: {
  row?: Pick<
    VariantSummary,
    'variantId' | 'plannedCount' | 'completedCount' | 'blockedCount' | 'stateCounts'
  >;
  runState?: RunState;
  live: boolean;
  tasks: TaskObject[];
  queueLabel?: string;
}): Activity {
  if (queueLabel) return { label: queueLabel, tone: 'warn', pulse: false };
  if (!row) return { label: 'Not in this run', tone: 'idle', pulse: false };
  if (row.plannedCount > 0 && row.completedCount === row.plannedCount)
    return { label: 'Complete', tone: 'go', pulse: false };
  // Summary counts cover the entire run; tasks also include source preparation.
  const active =
    ACTIVE.some((state) => (row.stateCounts[state] ?? 0) > 0) ||
    tasks.some((t) => t.variantId === row.variantId && ACTIVE.includes(t.state));
  if ((!active || runState !== 'running' || !live) && row.blockedCount)
    return { label: `${row.blockedCount} blocked`, tone: 'bad', pulse: false };
  if ((!active || runState !== 'running' || !live) && row.stateCounts.failed)
    return { label: `${row.stateCounts.failed} failed`, tone: 'bad', pulse: false };
  if (!live) return { label: 'Saved checkpoint', tone: 'idle', pulse: false };
  if (runState !== 'running') return { label: runState ?? 'Waiting', tone: 'idle', pulse: false };
  if (active) {
    const working=tasks.filter(t=>t.variantId===row.variantId && ACTIVE.includes(t.state));
    const preparing=working.some(t=>!t.questionId);
    const answering=working.some(t=>!!t.questionId) || ACTIVE.some(state=>(row.stateCounts[state] ?? 0)>0);
    const label=preparing && !answering ? 'Preparing video · no answer completed yet' : 'Answering questions';
    return {label:row.blockedCount ? `${label} · ${row.blockedCount} blocked` : label,tone:row.blockedCount ? 'bad' : 'go',pulse:true};
  }
  if (row.stateCounts.failed)
    return { label: `${row.stateCounts.failed} failed`, tone: 'bad', pulse: false };
  if (row.stateCounts.waiting_quota)
    return { label: 'Waiting for quota', tone: 'warn', pulse: false };
  if (row.blockedCount) return { label: `${row.blockedCount} blocked`, tone: 'bad', pulse: false };
  return { label: 'Preparing / queued', tone: 'warn', pulse: false };
}

export function retryCountdown(nextRetryAt: string | null | undefined, now: number): string | null {
  const at = nextRetryAt ? Date.parse(nextRetryAt) : NaN;
  if (!Number.isFinite(at)) return null;
  const seconds = Math.ceil((at - now) / 1000);
  if (seconds <= 0) return 'checking capacity…';
  return `in ${seconds >= 60 ? `${Math.floor(seconds / 60)}m ` : ''}${seconds % 60}s`;
}
