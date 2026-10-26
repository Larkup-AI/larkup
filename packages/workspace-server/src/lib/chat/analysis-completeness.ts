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
  const explicitCap = text.match(
    /(?:not\s+more\s+than|no\s+more\s+than|at\s+most|maximum(?:\s+of)?|max(?:imum)?)[^\d]{0,20}(\d{1,3})\s+times?/i,
  );
  const directionalCap = text.match(
    /\b(\d{1,3})\s+times?\s+(?:they|the\s+(?:person|participant))\s+(?:might|may|can|could|should)\s+be\s+(?:a\s+good\s+)?match(?:ed)?\s+for\s+someone\b/i,
  );
  const value = Number(explicitCap?.[1] ?? directionalCap?.[1]);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function cell(row: Record<string, unknown>, column: string) {
  return String(row[column] ?? '').trim();
}

function identity(value: string) {
  return value.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

/** Validate hard N × K matching constraints before a paged artifact is shown. */
export function validateAnalysisCompleteness(
  requestText: string,
  presentation: AnalysisPresentation | undefined,
  availableItems?: number,
): AnalysisCompletenessResult {
  const targets = requestedLongAnalysisItemCount(requestText, availableItems);
  const matchesPerTarget = requestedMatchesPerTarget(requestText);
  if (!targets || !matchesPerTarget) return { valid: true };
  if (!presentation || presentation.kind !== 'table') {
    return {
      valid: false,
      error: `Completeness validation failed: expected ${targets} targets with ${matchesPerTarget} matches each, but no result table was produced.`,
    };
  }

  const participantColumn = presentation.columns.find(
    (column) =>
      !/e-?mail|reason|explanation|rank|score/i.test(column) &&
      /participant|person[_ ]?name|from.*(?:name|guest|participant)|needing|source/i.test(column),
  );
  const matchColumns = presentation.columns.filter(
    (column) =>
      column !== participantColumn &&
      !/e-?mail|reason|explanation|why|rank|score/i.test(column) &&
      /match|matched|to.*(?:name|guest|participant)|suggest|recommend/i.test(column),
  );
  if (!participantColumn || matchColumns.length === 0) {
    return {
      valid: false,
      error: `Completeness validation failed: the result table must identify each target and its ${matchesPerTarget} matches.`,
    };
  }

  if (matchColumns.length >= matchesPerTarget && presentation.rows.length === targets) {
    const selectedMatchColumns = matchColumns.slice(0, matchesPerTarget);
    const reasonColumns = presentation.columns.filter((column) =>
      /reason|explanation|why/i.test(column),
    );
    const emailColumns = presentation.columns.filter((column) => /e-?mail/i.test(column));
    const requiresReasons = /\b(?:reason|explanation|explain|why)\b/i.test(requestText);
    const requiresEmails = /\be-?mail\b/i.test(requestText);
    const targetIdentities = new Set<string>();
    const suggestionCounts = new Map<string, number>();
    let complete = true;
    for (const row of presentation.rows) {
      const participant = identity(cell(row, participantColumn));
      const matches = selectedMatchColumns.map((column) => identity(cell(row, column)));
      if (
        !participant ||
        targetIdentities.has(participant) ||
        matches.some((match) => !match || match === participant) ||
        new Set(matches).size !== matchesPerTarget ||
        (requiresReasons && reasonColumns.length < matchesPerTarget) ||
        (requiresReasons &&
          reasonColumns.slice(0, matchesPerTarget).some((column) => !cell(row, column))) ||
        (requiresEmails && emailColumns.length < matchesPerTarget) ||
        (requiresEmails &&
          emailColumns.slice(0, matchesPerTarget).some((column) => !cell(row, column)))
      ) {
        complete = false;
        break;
      }
      targetIdentities.add(participant);
      for (const match of matches) {
        suggestionCounts.set(match, (suggestionCounts.get(match) ?? 0) + 1);
      }
    }
    const cap = requestedSuggestionCap(requestText);
    const maximumReuse = Math.max(0, ...suggestionCounts.values());
    complete = complete && (cap === undefined || maximumReuse <= cap);
    return complete
      ? { valid: true }
      : {
          valid: false,
          error: `Completeness validation failed: every one of the ${targets} unique targets must have ${matchesPerTarget} unique, non-self matches${
            requiresReasons ? ', populated reasons' : ''
          }${requiresEmails ? ', populated email addresses' : ''}${
            cap === undefined ? '' : `, and candidate reuse no greater than ${cap}`
          }.`,
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
  const pairs = new Set<string>();
  const reasonColumn = presentation.columns.find((column) =>
    /reason|explanation|why/i.test(column),
  );
  const emailColumn = presentation.columns.find((column) => /e-?mail/i.test(column));
  const requiresReasons = /\b(?:reason|explanation|explain|why)\b/i.test(requestText);
  const requiresEmails = /\be-?mail\b/i.test(requestText);
  let invalidRow = false;
  for (const row of presentation.rows) {
    const participant = identity(cell(row, participantColumn));
    const suggestion = identity(cell(row, matchColumns[0]));
    const pair = `${participant}\u0000${suggestion}`;
    if (
      !participant ||
      !suggestion ||
      participant === suggestion ||
      pairs.has(pair) ||
      (requiresReasons && (!reasonColumn || !cell(row, reasonColumn))) ||
      (requiresEmails && (!emailColumn || !cell(row, emailColumn)))
    ) {
      invalidRow = true;
    }
    pairs.add(pair);
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
    !invalidRow &&
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
