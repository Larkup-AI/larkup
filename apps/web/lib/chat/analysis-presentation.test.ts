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
});
