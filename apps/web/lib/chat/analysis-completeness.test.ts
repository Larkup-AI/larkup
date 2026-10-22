import { describe, expect, it } from 'vitest';
import { validateAnalysisCompleteness } from '@larkup/workspace-server/lib/chat/analysis-completeness';

const request =
  'For the first 25 people, make 3 matches. Every person can be suggested not more than 3 times.';

function table(rows: Array<Record<string, string>>) {
  return {
    kind: 'table' as const,
    title: 'Matches',
    columns: ['participant', 'matched_with', 'reason'],
    rows,
    totalItems: rows.length,
    requestedItems: 25,
    complete: true,
  };
}

describe('validateAnalysisCompleteness', () => {
  it('accepts exactly three matches for every requested participant', () => {
    const rows = Array.from({ length: 25 }, (_, participant) =>
      Array.from({ length: 3 }, (_, match) => ({
        participant: `Person ${participant + 1}`,
        matched_with: `Match ${(participant * 3 + match) % 25}`,
        reason: 'Relevant expertise',
      })),
    ).flat();

    expect(validateAnalysisCompleteness(request, table(rows))).toEqual({ valid: true });
  });

  it('rejects a plausible-looking partial result and explains how to repair it', () => {
    const rows = Array.from({ length: 22 }, (_, participant) =>
      Array.from({ length: 3 }, (_, match) => ({
        participant: `Person ${participant + 1}`,
        matched_with: `Match ${(participant * 3 + match) % 25}`,
        reason: 'Relevant expertise',
      })),
    ).flat();
    const result = validateAnalysisCompleteness(request, table(rows));

    expect(result.valid).toBe(false);
    expect(result.error).toContain('expected 25 targets × 3 matches (75 rows)');
    expect(result.error).toContain('got 22 targets and 66 rows');
  });

  it('rejects a global suggestion cap violation', () => {
    const rows = Array.from({ length: 25 }, (_, participant) =>
      Array.from({ length: 3 }, (_, match) => ({
        participant: `Person ${participant + 1}`,
        matched_with: match === 0 ? 'Overused Person' : `Match ${participant}-${match}`,
        reason: 'Relevant expertise',
      })),
    ).flat();

    expect(validateAnalysisCompleteness(request, table(rows)).error).toContain(
      'maximum suggestion reuse 25 (limit 3)',
    );
  });

  it('recognizes generated from/to identity column names', () => {
    const rows = Array.from({ length: 25 }, (_, participant) =>
      Array.from({ length: 3 }, (_, match) => ({
        from_first_name: `Person ${participant + 1}`,
        to_first_name: `Match ${(participant * 3 + match) % 25}`,
        explanation: 'Relevant expertise',
      })),
    ).flat();

    expect(
      validateAnalysisCompleteness(request, {
        kind: 'table',
        title: 'Matches',
        columns: ['from_first_name', 'to_first_name', 'explanation'],
        rows,
        totalItems: 75,
        requestedItems: 25,
        complete: true,
      }),
    ).toEqual({ valid: true });
  });
});
