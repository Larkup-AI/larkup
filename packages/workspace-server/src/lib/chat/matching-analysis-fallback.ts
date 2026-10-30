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

/** Build a deterministic stdlib-only engine for constrained participant matching. */
export function buildMatchingAnalysisFallback(
  requestText: string,
  dataset: Pick<TabularDataset, 'columns' | 'rowCount'>,
): string | undefined {
  const spec = matchingAnalysisSpec(requestText, dataset.rowCount);
  if (!spec || dataset.rowCount <= spec.matchesPerTarget) return undefined;

  const columns = dataset.columns.map((column) => column.name);
  const email = bestColumn(columns, [
    { pattern: /^e ?mail(?: address)?$/, score: 100 },
    { pattern: /\be ?mail(?: address)?\b/, score: 60 },
  ]);
  const identity =
    bestColumn(columns, [
      { pattern: /^name$/, score: 100 },
      { pattern: /\bfull name\b/, score: 90 },
      { pattern: /\bfirst name\b/, score: 80 },
      { pattern: /\bparticipant name\b/, score: 80 },
      { pattern: /\bguest id\b/, score: 50 },
      { pattern: /\bname\b/, score: 20 },
    ]) ||
    bestColumn(columns, [
      { pattern: /\bparticipant\b/, score: 60 },
      { pattern: /\bprofile\b/, score: 50 },
      { pattern: /\bidentifier\b|\bid\b/, score: 30 },
    ]) ||
    email ||
    columns[0];
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
  if (!identity) return undefined;

  const metadataPattern =
    /\b(?:created|updated|timestamp|date|status|approval|consent|ticket|referrer|linkedin|phone|address|company|organisation|organization|industry)\b/;
  const descriptiveColumns = columns.filter(
    (column) =>
      column !== identity && column !== email && !metadataPattern.test(normalized(column)),
  );
  const fallbackSignals =
    descriptiveColumns.length > 0
      ? descriptiveColumns
      : columns.filter((column) => column !== identity && column !== email);
  const needColumns = needs ? [needs] : fallbackSignals;
  const offerColumns = resolvedOffers ? [resolvedOffers] : fallbackSignals;
  if (needColumns.length === 0 || offerColumns.length === 0) return undefined;

  const settings = JSON.stringify({
    ...spec,
    identity,
    needs: needColumns,
    offers: offerColumns,
    email,
  });
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

def _matching_fields(person, columns):
    return " ".join(_matching_text(person.get(column)) for column in columns if _matching_text(person.get(column)))

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
_matching_preferences = []
for _target_index in range(_matching_targets):
    _target = _matching_people[_target_index]
    _need_text = _matching_fields(_target, _matching_settings["needs"])
    _need_tokens = _matching_tokens(_need_text)
    _candidates = []
    for _candidate_index, _candidate in enumerate(_matching_people):
        if _candidate_index == _target_index:
            continue
        _offer_text = _matching_fields(_candidate, _matching_settings["offers"])
        _offer_tokens = _matching_tokens(_offer_text)
        _shared = sorted(_need_tokens.intersection(_offer_tokens))
        _union = _need_tokens.union(_offer_tokens)
        _jaccard = len(_shared) / len(_union) if _union else 0.0
        _sequence = difflib.SequenceMatcher(None, _need_text.casefold(), _offer_text.casefold()).ratio()
        _score = len(_shared) * 10.0 + _jaccard * 3.0 + _sequence
        _candidates.append((-_score, _matching_labels_all[_candidate_index].casefold(), _candidate_index, _shared))
    _candidates.sort()
    _matching_preferences.append(_candidates)

_matching_required = _matching_targets * _matching_settings["matchesPerTarget"]
_matching_capacity = len(_matching_people) * _matching_settings["suggestionCap"]
if _matching_capacity < _matching_required:
    raise RuntimeError("The requested candidate reuse limit is mathematically impossible for this dataset")

# Solve the full capacity-constrained assignment as one flow network. This
# guarantees every invariant together, including caps smaller than K.
class _MatchingEdge:
    def __init__(self, to, reverse, capacity):
        self.to = to
        self.reverse = reverse
        self.capacity = capacity

_matching_node_count = 2 + _matching_targets + len(_matching_people)
_matching_source = _matching_node_count - 2
_matching_sink = _matching_node_count - 1
_matching_graph = [[] for _ in range(_matching_node_count)]

def _matching_add_edge(start, end, capacity):
    forward = _MatchingEdge(end, len(_matching_graph[end]), capacity)
    backward = _MatchingEdge(start, len(_matching_graph[start]), 0)
    _matching_graph[start].append(forward)
    _matching_graph[end].append(backward)
    return forward

for _target_index in range(_matching_targets):
    _matching_add_edge(_matching_source, _target_index, _matching_settings["matchesPerTarget"])

_matching_pair_edges = []
for _target_index, _preferences in enumerate(_matching_preferences):
    for _preference_rank, (_, _, _candidate_index, _shared) in enumerate(_preferences):
        _candidate_node = _matching_targets + _candidate_index
        _edge = _matching_add_edge(_target_index, _candidate_node, 1)
        _matching_pair_edges.append((_target_index, _candidate_index, _preference_rank, _shared, _edge))

for _candidate_index in range(len(_matching_people)):
    _matching_add_edge(
        _matching_targets + _candidate_index,
        _matching_sink,
        _matching_settings["suggestionCap"],
    )

def _matching_flow():
    total = 0
    while True:
        levels = [-1] * _matching_node_count
        levels[_matching_source] = 0
        queue = [_matching_source]
        for node in queue:
            for edge in _matching_graph[node]:
                if edge.capacity > 0 and levels[edge.to] < 0:
                    levels[edge.to] = levels[node] + 1
                    queue.append(edge.to)
        if levels[_matching_sink] < 0:
            return total
        positions = [0] * _matching_node_count

        def send(node, amount):
            if node == _matching_sink:
                return amount
            while positions[node] < len(_matching_graph[node]):
                edge = _matching_graph[node][positions[node]]
                if edge.capacity > 0 and levels[edge.to] == levels[node] + 1:
                    pushed = send(edge.to, min(amount, edge.capacity))
                    if pushed:
                        edge.capacity -= pushed
                        _matching_graph[edge.to][edge.reverse].capacity += pushed
                        return pushed
                positions[node] += 1
            return 0

        while True:
            pushed = send(_matching_source, _matching_required - total)
            if not pushed:
                break
            total += pushed
            if total == _matching_required:
                return total

if _matching_flow() != _matching_required:
    raise RuntimeError("The requested matching constraints cannot be satisfied by this dataset")

_matching_selected = [[] for _ in range(_matching_targets)]
for _target_index, _candidate_index, _preference_rank, _shared, _edge in _matching_pair_edges:
    if _edge.capacity == 0:
        _matching_selected[_target_index].append((_preference_rank, _candidate_index, _shared))
        _matching_usage[_candidate_index] += 1
for _selected in _matching_selected:
    _selected.sort()

for _target_index, _selected in enumerate(_matching_selected):
    for _rank, (_, _candidate_index, _shared) in enumerate(_selected, start=1):
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
