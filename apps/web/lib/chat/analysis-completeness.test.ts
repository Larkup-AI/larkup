import { describe, expect, it } from 'vitest';
import {
  requestedSuggestionCap,
  validateAnalysisCompleteness,
} from '@larkup/workspace-server/lib/chat/analysis-completeness';

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
  it('derives all-target completeness and the incoming-match cap from natural wording', () => {
    const naturalRequest =
      'For each person, make 3 matches. Each person should be matched with no more than 6 people in total: 3 times they might be a good match for someone, and 3 times they should be matched with someone.';
    expect(requestedSuggestionCap(naturalRequest)).toBe(3);
    expect(validateAnalysisCompleteness(naturalRequest, undefined, 102)).toEqual({
      valid: false,
      error:
        'Completeness validation failed: expected 102 targets with 3 matches each, but no result table was produced.',
    });
  });
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

  it('rejects duplicate, self, and under-documented matches', () => {
    const strictRequest =
      'For the first 2 people, make 2 matches. For every match, write an explanation and mention their email.';
    const result = validateAnalysisCompleteness(strictRequest, {
      kind: 'table',
      title: 'Matches',
      columns: ['Participant', 'Match', 'Email', 'Reason'],
      rows: [
        { Participant: 'Ada', Match: 'Ada', Email: 'ada@example.test', Reason: 'Self' },
        { Participant: 'Ada', Match: 'Ada', Email: 'ada@example.test', Reason: 'Duplicate' },
        { Participant: 'Lin', Match: 'Sam', Email: '', Reason: '' },
        { Participant: 'Lin', Match: 'Jo', Email: 'jo@example.test', Reason: 'Relevant' },
      ],
      totalItems: 4,
      requestedItems: 2,
      complete: true,
    });

    expect(result.valid).toBe(false);
  });
});
