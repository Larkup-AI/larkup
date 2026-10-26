import type { TabularDataset } from '@larkup/core/tabular-store';
import { requestedMatchesPerTarget, requestedSuggestionCap } from './analysis-completeness';
import { requestedLongAnalysisItemCount } from './tabular-routing';

export interface MatchingAnalysisSpec {
  targetCount: number;
  matchesPerTarget: number;
  suggestionCap: number;
}

function normalized(value: string) {
  return value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function bestColumn(
  columns: string[],
  patterns: Array<{ pattern: RegExp; score: number }>,
  excluded = new Set<string>(),
) {
  return columns
    .filter((column) => !excluded.has(column))
    .map((column, index) => ({
      column,
      index,
      score: patterns.reduce(
        (total, candidate) =>
          total + (candidate.pattern.test(normalized(column)) ? candidate.score : 0),
        0,
      ),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.column;
}

export function matchingAnalysisSpec(
  requestText: string,
  availableItems?: number,
): MatchingAnalysisSpec | undefined {
  const targetCount = requestedLongAnalysisItemCount(requestText, availableItems);
  const matchesPerTarget = requestedMatchesPerTarget(requestText);
  if (!targetCount || !matchesPerTarget || matchesPerTarget > 20) return undefined;
  const suggestionCap = requestedSuggestionCap(requestText) ?? targetCount * matchesPerTarget;
  return { targetCount, matchesPerTarget, suggestionCap };
}

/**
 * Build a deterministic stdlib-only repair for constrained participant matching.
 * This runs only after model-authored analysis failed completeness validation.
 */
export function buildMatchingAnalysisFallback(
  requestText: string,
  dataset: Pick<TabularDataset, 'columns' | 'rowCount'>,
): string | undefined {
  const spec = matchingAnalysisSpec(requestText, dataset.rowCount);
  if (!spec || dataset.rowCount <= spec.matchesPerTarget) return undefined;

  const columns = dataset.columns.map((column) => column.name);
  const identity = bestColumn(columns, [
    { pattern: /^name$/, score: 100 },
    { pattern: /\bfull name\b/, score: 90 },
    { pattern: /\bfirst name\b/, score: 80 },
    { pattern: /\bparticipant name\b/, score: 80 },
    { pattern: /\bguest id\b/, score: 50 },
    { pattern: /\bname\b/, score: 20 },
  ]);
  const needs = bestColumn(columns, [
    { pattern: /\bcurrent needs?\b/, score: 100 },
    { pattern: /\bbenefit from (?:the )?most\b/, score: 90 },
    { pattern: /\blooking for\b/, score: 70 },
    { pattern: /\bneed(?:s|ed)?\b/, score: 30 },
    { pattern: /\bchallenge(?:s)?\b/, score: 20 },
  ]);
  const offers = bestColumn(
    columns,
    [
      { pattern: /\bknowledge (?:and )?expertise\b/, score: 100 },
      { pattern: /\bhelp others?\b/, score: 90 },
      { pattern: /\bcan offer\b/, score: 80 },
      { pattern: /\bwhat .* offer\b/, score: 70 },
      { pattern: /\bbringing to (?:the )?table\b/, score: 70 },
      { pattern: /\banything else .* add\b/, score: 45 },
      { pattern: /\blooking for\b/, score: 30 },
      { pattern: /\bexpertise\b/, score: 40 },
      { pattern: /\bskills?\b/, score: 25 },
      { pattern: /\boffer(?:s|ed|ing)?\b/, score: 20 },
    ],
    new Set(needs ? [needs] : []),
  );
  const resolvedOffers =
    offers ||
    bestColumn(columns, [
      { pattern: /\bbringing to (?:the )?table\b/, score: 70 },
      { pattern: /\banything else .* add\b/, score: 45 },
      { pattern: /\blooking for\b/, score: 30 },
      { pattern: /\boffer(?:s|ed|ing)?\b/, score: 20 },
    ]);
  if (!identity || !needs || !resolvedOffers) return undefined;

  const email = bestColumn(columns, [
    { pattern: /^e ?mail(?: address)?$/, score: 100 },
    { pattern: /\be ?mail(?: address)?\b/, score: 60 },
  ]);

  const settings = JSON.stringify({ ...spec, identity, needs, offers: resolvedOffers, email });
  return String.raw`
import csv
import difflib
import re

_matching_settings = ${settings}
with open("data.csv", "r", encoding="utf-8-sig", newline="") as _matching_file:
    _matching_people = list(csv.DictReader(_matching_file))

_matching_stopwords = {
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "i", "in", "is",
    "it", "my", "of", "on", "or", "our", "that", "the", "their", "this", "to", "we", "with",
}

def _matching_text(value):
    return " ".join(str(value or "").split())

def _matching_tokens(value):
    return {
        token for token in re.findall(r"[^\W_]+", _matching_text(value).casefold(), flags=re.UNICODE)
        if len(token) > 2 and token not in _matching_stopwords
    }

def _matching_labels(people, column):
    raw = [_matching_text(person.get(column)) or "Participant " + str(index + 1) for index, person in enumerate(people)]
    counts = {value: raw.count(value) for value in set(raw)}
    return [value if counts[value] == 1 else value + " [row " + str(index + 1) + "]" for index, value in enumerate(raw)]

_matching_labels_all = _matching_labels(_matching_people, _matching_settings["identity"])
_matching_usage = [0] * len(_matching_people)
_matching_rows = []
_matching_targets = min(_matching_settings["targetCount"], len(_matching_people))

for _target_index in range(_matching_targets):
    _target = _matching_people[_target_index]
    _need_text = _matching_text(_target.get(_matching_settings["needs"]))
    _need_tokens = _matching_tokens(_need_text)
    _candidates = []
    for _candidate_index, _candidate in enumerate(_matching_people):
        if _candidate_index == _target_index or _matching_usage[_candidate_index] >= _matching_settings["suggestionCap"]:
            continue
        _offer_text = _matching_text(_candidate.get(_matching_settings["offers"]))
        _offer_tokens = _matching_tokens(_offer_text)
        _shared = sorted(_need_tokens.intersection(_offer_tokens))
        _union = _need_tokens.union(_offer_tokens)
        _jaccard = len(_shared) / len(_union) if _union else 0.0
        _sequence = difflib.SequenceMatcher(None, _need_text.casefold(), _offer_text.casefold()).ratio()
        _score = len(_shared) * 10.0 + _jaccard * 3.0 + _sequence
        _candidates.append((-_score, _matching_usage[_candidate_index], _matching_labels_all[_candidate_index].casefold(), _candidate_index, _shared))
    _candidates.sort()
    _selected = _candidates[:_matching_settings["matchesPerTarget"]]
    if len(_selected) != _matching_settings["matchesPerTarget"]:
        raise RuntimeError("Not enough eligible candidates to satisfy every requested match and reuse limit")
    for _rank, (_, _, _, _candidate_index, _shared) in enumerate(_selected, start=1):
        _matching_usage[_candidate_index] += 1
        _target_label = _matching_labels_all[_target_index]
        _candidate_label = _matching_labels_all[_candidate_index]
        _selected_candidate = _matching_people[_candidate_index]
        _candidate_email = _matching_text(_selected_candidate.get(_matching_settings.get("email"))) if _matching_settings.get("email") else ""
        if _shared:
            _reason = _candidate_label + " matches " + _target_label + " through relevant expertise in " + ", ".join(_shared[:3]) + "."
        else:
            _reason = _candidate_label + " is the best remaining eligible profile for " + _target_label + " after comparing the stated needs and offered expertise while respecting the reuse limit."
        _matching_rows.append({"Participant": _target_label, "Match": _candidate_label, "Email": _candidate_email, "Rank": _rank, "Reason": _reason})

if len(_matching_rows) != _matching_targets * _matching_settings["matchesPerTarget"]:
    raise RuntimeError("Matching result is incomplete")
if max(_matching_usage, default=0) > _matching_settings["suggestionCap"]:
    raise RuntimeError("Matching result exceeds the suggestion reuse limit")

larkup_table(
    "Participant matches",
    _matching_rows,
    ["Participant", "Match", "Email", "Rank", "Reason"],
    summary=str(_matching_targets) + " participants with " + str(_matching_settings["matchesPerTarget"]) + " matches each",
    requested_items=_matching_targets,
    file_name="participant-matches.csv",
)
`;
}
