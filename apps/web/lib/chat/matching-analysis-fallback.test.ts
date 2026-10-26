import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  extractAnalysisPresentation,
  withAnalysisPresentationHelpers,
} from '@larkup/workspace-server/lib/chat/analysis-presentation';
import { buildMatchingAnalysisFallback } from '@larkup/workspace-server/lib/chat/matching-analysis-fallback';
import { validateAnalysisCompleteness } from '@larkup/workspace-server/lib/chat/analysis-completeness';

const request =
  'For the first 25 people from the list, make 3 matches. Every person can be suggested not more than 3 times.';

describe('buildMatchingAnalysisFallback', () => {
  it('prepares all 75 rows without pandas even when semantic overlap is zero', () => {
    const columns = [
      'Name',
      'Question: What are your current needs and what would you benefit from the most?',
      'Question 1: Knowledge & Expertise — What can you help others with?',
    ];
    const code = buildMatchingAnalysisFallback(request, {
      columns: columns.map((name) => ({ name })) as never,
      rowCount: 30,
    });
    expect(code).toBeTruthy();

    const directory = mkdtempSync(join(tmpdir(), 'larkup-matching-'));
    const csv = [
      columns.map((column) => JSON.stringify(column)).join(','),
      ...Array.from({ length: 30 }, (_, index) =>
        [
          JSON.stringify(`Person ${index + 1}`),
          JSON.stringify(`Need ${index % 7}`),
          JSON.stringify(`Offer ${(index + 3) % 7}`),
        ].join(','),
      ),
    ].join('\n');
    writeFileSync(join(directory, 'data.csv'), csv);
    const stdout = execFileSync('python3', ['-c', withAnalysisPresentationHelpers(code!, 25)], {
      cwd: directory,
      encoding: 'utf8',
    });
    const presentation = extractAnalysisPresentation(stdout).presentation;

    expect(presentation).toMatchObject({ kind: 'table', totalItems: 75, requestedItems: 25 });
    expect(validateAnalysisCompleteness(request, presentation)).toEqual({ valid: true });
  });

  it('handles every survey row, combined offer wording, email output, and balanced reuse', () => {
    const naturalRequest =
      'You have a data document listing 102 participants. For each person from the list, make 3 matches. Each person should be matched with no more than 6 people in total: 3 times they might be a good match for someone, and 3 times they should be matched with someone. For every match, write an explanation and mention their email.';
    const columns = [
      'Name',
      'Email Address',
      'Question 2: Current Needs: "What would you benefit from most right now?"',
      "Question 3: \"Anything else you'd like to add? Share what you're bringing to the table or what you're looking for.\"",
    ];
    const code = buildMatchingAnalysisFallback(naturalRequest, {
      columns: columns.map((name) => ({ name })) as never,
      rowCount: 102,
    });
    expect(code).toBeTruthy();

    const directory = mkdtempSync(join(tmpdir(), 'larkup-matching-survey-'));
    const csv = [
      columns.map((column) => JSON.stringify(column)).join(','),
      ...Array.from({ length: 102 }, (_, index) =>
        [
          JSON.stringify(`Person ${index + 1}`),
          JSON.stringify(`person${index + 1}@example.test`),
          JSON.stringify(`Need ${index % 11}`),
          JSON.stringify(`Offer ${(index + 3) % 11}`),
        ].join(','),
      ),
    ].join('\n');
    writeFileSync(join(directory, 'data.csv'), csv);
    const stdout = execFileSync('python3', ['-c', withAnalysisPresentationHelpers(code!, 102)], {
      cwd: directory,
      encoding: 'utf8',
    });
    const presentation = extractAnalysisPresentation(stdout).presentation;

    expect(presentation).toMatchObject({ kind: 'table', totalItems: 306, requestedItems: 102 });
    expect(presentation?.kind === 'table' && presentation.columns).toContain('Email');
    if (presentation?.kind === 'table') {
      for (const row of presentation.rows) {
        expect(row.Email).toBe(`${String(row.Match).replace('Person ', 'person')}@example.test`);
      }
    }
    expect(validateAnalysisCompleteness(naturalRequest, presentation, 102)).toEqual({
      valid: true,
    });
  });
});
