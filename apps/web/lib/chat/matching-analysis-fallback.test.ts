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
});
