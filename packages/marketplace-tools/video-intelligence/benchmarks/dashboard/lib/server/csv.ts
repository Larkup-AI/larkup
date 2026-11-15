/**
 * Stable, sanitized CSV export of per-question results. Built server-side so
 * the browser never assembles provider data. No secrets, paths or raw provider
 * payloads are emitted. Null stays empty (never coerced to 0/false).
 */
import type { ResultObject } from '../contract.js';

const COLUMNS: Array<{ key: string; get: (r: ResultObject) => unknown }> = [
  { key: 'runId', get: (r) => r.runId },
  { key: 'sourceId', get: (r) => r.sourceId },
  { key: 'dataset', get: (r) => r.dataset },
  { key: 'questionId', get: (r) => r.questionId },
  { key: 'variantId', get: (r) => r.variantId },
  { key: 'durationGroup', get: (r) => r.durationGroup },
  { key: 'sourceDurationMs', get: (r) => r.sourceDurationMs },
  { key: 'provider', get: (r) => r.provider },
  { key: 'accountAlias', get: (r) => r.accountAlias },
  { key: 'routeId', get: (r) => r.routeId },
  { key: 'tier', get: (r) => r.tier },
  { key: 'logicalModel', get: (r) => r.logicalModel },
  { key: 'resolvedModel', get: (r) => r.resolvedModel },
  { key: 'state', get: (r) => r.state },
  { key: 'predictedOption', get: (r) => r.predictedOption },
  { key: 'correct', get: (r) => (r.correct === null ? '' : r.correct) },
  { key: 'evaluationRevision', get: (r) => r.evaluationRevision },
  { key: 'costCurrency', get: (r) => r.cost.currency },
  { key: 'costActual', get: (r) => r.cost.actual },
  { key: 'costEstimated', get: (r) => r.cost.estimated },
  { key: 'costReconciled', get: (r) => r.cost.reconciled },
  { key: 'queueMs', get: (r) => r.timing.queueMs },
  { key: 'prepareMs', get: (r) => r.timing.prepareMs },
  { key: 'uploadMs', get: (r) => r.timing.uploadMs },
  { key: 'indexMs', get: (r) => r.timing.indexMs },
  { key: 'answerMs', get: (r) => r.timing.answerMs },
  { key: 'firstTokenMs', get: (r) => r.timing.firstTokenMs },
  { key: 'endToEndMs', get: (r) => r.timing.endToEndMs },
  { key: 'inputReuse', get: (r) => r.timing.inputReuse },
  { key: 'inputTokens', get: (r) => r.usage.inputTokens },
  { key: 'outputTokens', get: (r) => r.usage.outputTokens },
  { key: 'processingSeconds', get: (r) => r.usage.processingSeconds },
  { key: 'freeAllowanceConsumed', get: (r) => r.usage.freeAllowanceConsumed },
  { key: 'issueCode', get: (r) => r.issue?.code ?? '' },
];

function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function resultsToCsv(results: ResultObject[]): string {
  const header = COLUMNS.map((c) => c.key).join(',');
  const rows = results.map((r) => COLUMNS.map((c) => cell(c.get(r))).join(','));
  // CRLF line endings for stable spreadsheet import.
  return [header, ...rows].join('\r\n') + '\r\n';
}

/** Weak ETag over the CSV content for caching/Content-Disposition. */
export async function csvChecksum(csv: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(csv));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}
