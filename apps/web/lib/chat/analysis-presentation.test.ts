import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  extractAnalysisPresentation,
  withAnalysisPresentationHelpers,
} from '@larkup/workspace-server/lib/chat/analysis-presentation';

describe('analysis presentation runtime', () => {
  it('turns a small-model rows variable into a complete paged artifact', () => {
    const code = withAnalysisPresentationHelpers(
      `rows = [{"participant": f"Person {index}", "matches": ["A", "B", "C"]} for index in range(25)]\ncolumns = ["participant", "matches"]\nrows, columns`,
      25,
    );
    const stdout = execFileSync('python3', ['-c', code], { encoding: 'utf8' });
    const result = extractAnalysisPresentation(stdout);

    expect(result.presentation).toEqual(
      expect.objectContaining({
        kind: 'table',
        requestedItems: 25,
        totalItems: 25,
        complete: true,
      }),
    );
  });

  it('replaces an invalid model-authored requested_items value with the requested count', () => {
    const code = withAnalysisPresentationHelpers(
      `rows = [{"participant": f"Person {index}"} for index in range(25)]\nlarkup_table("Matches", rows, requested_items=["bad"])`,
      25,
    );
    const stdout = execFileSync('python3', ['-c', code], { encoding: 'utf8' });
    const result = extractAnalysisPresentation(stdout);

    expect(result.presentation).toEqual(
      expect.objectContaining({ requestedItems: 25, totalItems: 25, complete: true }),
    );
  });

  it('normalizes positional rows from values.tolist into table records', () => {
    const code = withAnalysisPresentationHelpers(
      `rows = [["Person 1", "Match 1", "Reason 1"], ["Person 2", "Match 2", "Reason 2"]]\ncolumns = ["Participant", "Match", "Reason"]\nlarkup_table("Matches", rows, columns, requested_items=2)`,
      2,
    );
    const stdout = execFileSync('python3', ['-c', code], { encoding: 'utf8' });
    const result = extractAnalysisPresentation(stdout);

    expect(result.presentation).toMatchObject({
      kind: 'table',
      columns: ['Participant', 'Match', 'Reason'],
      rows: [
        { Participant: 'Person 1', Match: 'Match 1', Reason: 'Reason 1' },
        { Participant: 'Person 2', Match: 'Match 2', Reason: 'Reason 2' },
      ],
      totalItems: 2,
      requestedItems: 2,
      complete: true,
    });
  });

  it('removes imports for the presentation helpers that are already injected', () => {
    const code = withAnalysisPresentationHelpers(
      `import larkup_table\nrows = [{"participant": "Person 1"}]\nlarkup_table("Matches", rows, requested_items=1)`,
      1,
    );
    const stdout = execFileSync('python3', ['-c', code], { encoding: 'utf8' });

    expect(extractAnalysisPresentation(stdout).presentation).toMatchObject({
      kind: 'table',
      totalItems: 1,
      complete: true,
    });
  });
});
