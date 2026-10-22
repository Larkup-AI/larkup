import type { AnalysisPresentation } from './analysis-presentation';
import { requestedLongAnalysisItemCount } from './tabular-routing';

export interface AnalysisCompletenessResult {
  valid: boolean;
  error?: string;
}

export function requestedMatchesPerTarget(text: string) {
  const match = text.match(
    /\b(?:make|find|give|suggest|recommend|provide|create)?\s*(\d{1,2})\s+(?:best\s+)?matches?\b/i,
  );
  const value = Number(match?.[1]);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

export function requestedSuggestionCap(text: string) {
  const match = text.match(
    /(?:not\s+more\s+than|no\s+more\s+than|at\s+most|maximum(?:\s+of)?|max(?:imum)?)[^\d]{0,20}(\d{1,3})\s+times?/i,
  );
  const value = Number(match?.[1]);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function cell(row: Record<string, unknown>, column: string) {
  return String(row[column] ?? '').trim();
}

/** Validate hard N × K matching constraints before a paged artifact is shown. */
export function validateAnalysisCompleteness(
  requestText: string,
  presentation: AnalysisPresentation | undefined,
): AnalysisCompletenessResult {
  const targets = requestedLongAnalysisItemCount(requestText);
  const matchesPerTarget = requestedMatchesPerTarget(requestText);
  if (!targets || !matchesPerTarget) return { valid: true };
  if (!presentation || presentation.kind !== 'table') {
    return {
      valid: false,
      error: `Completeness validation failed: expected ${targets} targets with ${matchesPerTarget} matches each, but no result table was produced.`,
    };
  }

  const participantColumn = presentation.columns.find((column) =>
    /participant|person[_ ]?name|from.*(?:name|guest|participant)|needing|source/i.test(column),
  );
  const matchColumns = presentation.columns.filter(
    (column) =>
      column !== participantColumn &&
      /match|matched|to.*(?:name|guest|participant)|suggest|recommend/i.test(column),
  );
  if (!participantColumn || matchColumns.length === 0) {
    return {
      valid: false,
      error: `Completeness validation failed: the result table must identify each target and its ${matchesPerTarget} matches.`,
    };
  }

  if (matchColumns.length >= matchesPerTarget && presentation.rows.length === targets) {
    const complete = presentation.rows.every((row) =>
      matchColumns.slice(0, matchesPerTarget).every((column) => cell(row, column)),
    );
    return complete
      ? { valid: true }
      : {
          valid: false,
          error: `Completeness validation failed: one or more of the ${targets} targets has fewer than ${matchesPerTarget} populated matches. Fill every slot, using the best remaining eligible candidate when semantic overlap is zero.`,
        };
  }

  if (matchColumns.length !== 1) {
    return {
      valid: false,
      error: `Completeness validation failed: expected ${targets} targets with ${matchesPerTarget} matches each in either long or wide table form.`,
    };
  }

  const participantCounts = new Map<string, number>();
  const suggestionCounts = new Map<string, number>();
  for (const row of presentation.rows) {
    const participant = cell(row, participantColumn);
    const suggestion = cell(row, matchColumns[0]);
    if (participant)
      participantCounts.set(participant, (participantCounts.get(participant) ?? 0) + 1);
    if (suggestion) suggestionCounts.set(suggestion, (suggestionCounts.get(suggestion) ?? 0) + 1);
  }
  const incompleteTargets = [...participantCounts.values()].filter(
    (count) => count !== matchesPerTarget,
  ).length;
  const expectedRows = targets * matchesPerTarget;
  const cap = requestedSuggestionCap(requestText);
  const maximumReuse = Math.max(0, ...suggestionCounts.values());
  if (
    presentation.rows.length === expectedRows &&
    participantCounts.size === targets &&
    incompleteTargets === 0 &&
    (cap === undefined || maximumReuse <= cap)
  ) {
    return { valid: true };
  }

  return {
    valid: false,
    error: `Completeness validation failed: expected ${targets} targets × ${matchesPerTarget} matches (${expectedRows} rows); got ${participantCounts.size} targets and ${presentation.rows.length} rows${
      cap === undefined ? '' : `, with maximum suggestion reuse ${maximumReuse} (limit ${cap})`
    }. Do not skip empty or zero-overlap targets; fill them with the best remaining eligible candidates, then assert all counts and limits before presenting.`,
  };
}
