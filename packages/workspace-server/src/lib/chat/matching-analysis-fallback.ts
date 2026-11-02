import type { TabularDataset } from '@larkup/core/tabular-store';
import { requestedMatchRange, requestedSuggestionCap } from './analysis-completeness';
import { requestedLongAnalysisItemCount } from './tabular-routing';

export interface MatchingAnalysisSpec {
  targetCount: number;
  minimumMatches: number;
  maximumMatches: number;
  suggestionCap: number;
  eligibilityScoped: boolean;
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
  const matchRange = requestedMatchRange(requestText);
  if (!targetCount || !matchRange) return undefined;
  const suggestionCap = requestedSuggestionCap(requestText) ?? targetCount * matchRange.max;
  return {
    targetCount,
    minimumMatches: matchRange.min,
    maximumMatches: matchRange.max,
    suggestionCap,
    eligibilityScoped: /\b(?:eligible|opt(?:ed)?[ -]?in|stated\s+(?:a\s+)?need)\b/i.test(
      requestText,
    ),
  };
}

/** Build a deterministic stdlib-only engine for constrained participant matching. */
export function buildMatchingAnalysisFallback(
  requestText: string,
  dataset: Pick<TabularDataset, 'columns' | 'rowCount'>,
): string | undefined {
  const spec = matchingAnalysisSpec(requestText, dataset.rowCount);
  if (!spec || dataset.rowCount <= spec.minimumMatches) return undefined;

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

  const additional = bestColumn(
    columns,
    [
      { pattern: /\banything else .* add\b/, score: 100 },
      { pattern: /\badditional (?:information|context)\b/, score: 80 },
      { pattern: /\bbringing to (?:the )?table\b/, score: 70 },
    ],
    new Set([needs, resolvedOffers].filter((value): value is string => Boolean(value))),
  );
  const optIn = bestColumn(columns, [
    { pattern: /^opt(?:ed)? in$/, score: 120 },
    { pattern: /\bopt(?:ed)?[ -]?in\b/, score: 100 },
    { pattern: /\bmatching (?:consent|eligible|status)\b/, score: 90 },
    { pattern: /^eligible$/, score: 80 },
  ]);
  const approval = bestColumn(columns, [
    { pattern: /^approval status$/, score: 100 },
    { pattern: /^registration status$/, score: 90 },
    { pattern: /^status$/, score: 20 },
  ]);
  const listNumber = bestColumn(columns, [
    { pattern: /^participant number$/, score: 100 },
    { pattern: /^list number$/, score: 90 },
    { pattern: /^guest id$/, score: 70 },
    { pattern: /^id$/, score: 20 },
  ]);
  const company = bestColumn(columns, [
    { pattern: /\bcompany\b/, score: 80 },
    { pattern: /\borganisation\b|\borganization\b/, score: 70 },
  ]);
  const linkedin = bestColumn(columns, [{ pattern: /\blinked ?in\b/, score: 100 }]);

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
  const needColumns = [
    ...new Set([...(needs ? [needs] : fallbackSignals), additional].filter(Boolean)),
  ];
  const offerColumns = [
    ...new Set(
      [...(resolvedOffers ? [resolvedOffers] : fallbackSignals), additional].filter(Boolean),
    ),
  ];
  if (needColumns.length === 0 || offerColumns.length === 0) return undefined;

  const settings = JSON.stringify({
    ...spec,
    identity,
    needs: needColumns,
    offers: offerColumns,
    email,
    optIn,
    approval,
    listNumber,
    company,
    linkedin,
  }).replace(
    /"eligibilityScoped":(true|false)/,
    (_match, value: string) => `"eligibilityScoped":${value === 'true' ? 'True' : 'False'}`,
  );
  return String.raw`
import csv
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

def _matching_clip(value, limit=180):
    value = _matching_text(value)
    return value if len(value) <= limit else value[:limit - 1].rstrip() + "…"

def _matching_fields(person, columns):
    return " ".join(_matching_text(person.get(column)) for column in columns if _matching_text(person.get(column)))

def _matching_tokens(value):
    tokens = set()
    for token in re.findall(r"[^\W_]+", _matching_text(value).casefold(), flags=re.UNICODE):
        if len(token) <= 2 or token in _matching_stopwords:
            continue
        # Light stemming makes survey labels such as "investors"/"investor"
        # and "contracts"/"contractual" comparable without inventing meaning.
        for suffix in ("ization", "isation", "ments", "ment", "ing", "ies", "ial", "ual", "ers", "er", "ed", "es", "s"):
            if len(token) > len(suffix) + 3 and token.endswith(suffix):
                token = token[:-len(suffix)]
                break
        tokens.add(token)
    return tokens

def _matching_allowed_status(person):
    column = _matching_settings.get("approval")
    if not column:
        return True
    value = _matching_text(person.get(column)).casefold()
    return not value or value in {"approved", "accepted", "active", "eligible", "yes", "true", "1"}

def _matching_opted_in(person):
    column = _matching_settings.get("optIn")
    if column:
        value = _matching_text(person.get(column)).casefold()
        if value in {"", "no", "false", "0", "declined", "rejected", "not eligible", "opted out"}:
            return False
        return True
    # Optional matching questionnaires encode consent through participation:
    # a row is a target only when it contains at least one matching answer.
    return bool(_matching_fields(person, _matching_settings["needs"]) or _matching_fields(person, _matching_settings["offers"]))

def _matching_labels(people, column):
    raw = [_matching_text(person.get(column)) or "Participant " + str(index + 1) for index, person in enumerate(people)]
    counts = {value: raw.count(value) for value in set(raw)}
    return [value if counts[value] == 1 else value + " [row " + str(index + 1) + "]" for index, value in enumerate(raw)]

_matching_labels_all = _matching_labels(_matching_people, _matching_settings["identity"])
_matching_usage = [0] * len(_matching_people)
_matching_rows = []
_matching_candidate_indexes = [
    index for index, person in enumerate(_matching_people)
    if (not _matching_settings["eligibilityScoped"] or
        (_matching_allowed_status(person) and _matching_opted_in(person)))
]
if _matching_settings["eligibilityScoped"]:
    _matching_target_indexes = list(_matching_candidate_indexes)
else:
    _matching_target_indexes = list(range(len(_matching_people)))[:_matching_settings["targetCount"]]
_matching_targets = len(_matching_target_indexes)
if not _matching_targets:
    raise RuntimeError("No eligible matching participants were found in the dataset")
if len(_matching_candidate_indexes) <= _matching_settings["minimumMatches"]:
    raise RuntimeError("There are not enough eligible candidates to satisfy the requested matches")

_matching_preferences = []
for _target_position, _target_index in enumerate(_matching_target_indexes):
    _target = _matching_people[_target_index]
    _need_text = _matching_fields(_target, _matching_settings["needs"])
    _need_tokens = _matching_tokens(_need_text)
    _candidates = []
    for _candidate_index in _matching_candidate_indexes:
        if _candidate_index == _target_index:
            continue
        _candidate = _matching_people[_candidate_index]
        _offer_text = _matching_fields(_candidate, _matching_settings["offers"])
        _offer_tokens = _matching_tokens(_offer_text)
        _shared = sorted(_need_tokens.intersection(_offer_tokens))
        _union = _need_tokens.union(_offer_tokens)
        _jaccard = len(_shared) / len(_union) if _union else 0.0
        _score = len(_shared) * 10.0 + _jaccard * 3.0
        # Rotate equal-score candidates per target. Besides deterministic
        # fairness this avoids a shared top-N bottleneck on sparse large data.
        _rotation = (_candidate_index - _target_index) % max(1, len(_matching_people))
        _candidates.append((-_score, _rotation, _matching_labels_all[_candidate_index].casefold(), _candidate_index, _shared))
    _candidates.sort()
    _matching_window = min(len(_candidates), max(128, _matching_settings["maximumMatches"] * 32))
    _matching_preferences.append(_candidates[:_matching_window])

_matching_required = _matching_targets * _matching_settings["minimumMatches"]
_matching_capacity = len(_matching_candidate_indexes) * _matching_settings["suggestionCap"]
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
    _matching_add_edge(_matching_source, _target_index, _matching_settings["minimumMatches"])

_matching_pair_edges = []
for _target_index, _preferences in enumerate(_matching_preferences):
    for _preference_rank, (_negative_score, _, _, _candidate_index, _shared) in enumerate(_preferences):
        _candidate_node = _matching_targets + _candidate_index
        _edge = _matching_add_edge(_target_index, _candidate_node, 1)
        _matching_pair_edges.append((_target_index, _candidate_index, _preference_rank, -_negative_score, _shared, _edge))

for _candidate_index in _matching_candidate_indexes:
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
_matching_selected_pairs = set()
for _target_index, _candidate_index, _preference_rank, _score, _shared, _edge in _matching_pair_edges:
    if _edge.capacity == 0:
        _matching_selected[_target_index].append((_preference_rank, _candidate_index, _score, _shared))
        _matching_selected_pairs.add((_target_index, _candidate_index))
        _matching_usage[_candidate_index] += 1
for _selected in _matching_selected:
    _selected.sort()

# A range such as 2-5 is intentionally relevance-sensitive: first guarantee
# the minimum globally, then add only evidence-backed matches in fair rounds.
for _extra_rank in range(_matching_settings["minimumMatches"], _matching_settings["maximumMatches"]):
    _proposals = []
    for _target_position, _preferences in enumerate(_matching_preferences):
        if len(_matching_selected[_target_position]) > _extra_rank:
            continue
        for _preference_rank, (_negative_score, _, _, _candidate_index, _shared) in enumerate(_preferences):
            _score = -_negative_score
            if _score <= 0:
                break
            if ((_target_position, _candidate_index) not in _matching_selected_pairs and
                    _matching_usage[_candidate_index] < _matching_settings["suggestionCap"]):
                _proposals.append((-_score, _preference_rank, _target_position, _candidate_index, _shared))
                break
    _proposals.sort()
    for _negative_score, _preference_rank, _target_position, _candidate_index, _shared in _proposals:
        if len(_matching_selected[_target_position]) > _extra_rank:
            continue
        if ((_target_position, _candidate_index) in _matching_selected_pairs or
                _matching_usage[_candidate_index] >= _matching_settings["suggestionCap"]):
            continue
        _matching_selected[_target_position].append((_preference_rank, _candidate_index, -_negative_score, _shared))
        _matching_selected_pairs.add((_target_position, _candidate_index))
        _matching_usage[_candidate_index] += 1

for _selected in _matching_selected:
    _selected.sort()

for _target_position, _selected in enumerate(_matching_selected):
    _target_index = _matching_target_indexes[_target_position]
    _target = _matching_people[_target_index]
    _target_need = _matching_clip(_matching_fields(_target, _matching_settings["needs"]))
    for _rank, (_, _candidate_index, _score, _shared) in enumerate(_selected, start=1):
        _target_label = _matching_labels_all[_target_index]
        _candidate_label = _matching_labels_all[_candidate_index]
        _selected_candidate = _matching_people[_candidate_index]
        _candidate_offer = _matching_clip(_matching_fields(_selected_candidate, _matching_settings["offers"]))
        _candidate_email = _matching_text(_selected_candidate.get(_matching_settings.get("email"))) if _matching_settings.get("email") else ""
        if _shared:
            _reason = _candidate_label + " stated \"" + _candidate_offer + "\", which directly overlaps with " + _target_label + "'s stated need \"" + _target_need + "\"."
        else:
            _reason = _candidate_label + " is the strongest remaining eligible profile under the global limits, although the dataset contains limited direct need-to-offer evidence."
        _row = {
            "Participant": _target_label,
            "Participant Email": _matching_text(_target.get(_matching_settings.get("email"))) if _matching_settings.get("email") else "",
            "Match": _candidate_label,
            "Match Email": _candidate_email,
            "Rank": _rank,
            "Reason": _reason,
        }
        for _label, _setting in (("Participant Number", "listNumber"), ("Participant Company", "company"), ("Participant LinkedIn", "linkedin")):
            if _matching_settings.get(_setting):
                _row[_label] = _matching_text(_target.get(_matching_settings[_setting]))
        for _label, _setting in (("Match Number", "listNumber"), ("Match Company", "company"), ("Match LinkedIn", "linkedin")):
            if _matching_settings.get(_setting):
                _row[_label] = _matching_text(_selected_candidate.get(_matching_settings[_setting]))
        _matching_rows.append(_row)

_matching_counts = [len(selected) for selected in _matching_selected]
if (len(_matching_counts) != _matching_targets or
        min(_matching_counts, default=0) < _matching_settings["minimumMatches"] or
        max(_matching_counts, default=0) > _matching_settings["maximumMatches"]):
    raise RuntimeError("Matching result is incomplete")
if max(_matching_usage, default=0) > _matching_settings["suggestionCap"]:
    raise RuntimeError("Matching result exceeds the suggestion reuse limit")

larkup_table(
    "Participant matches",
    _matching_rows,
    list(_matching_rows[0].keys()),
    summary=str(_matching_targets) + " eligible participants with " + str(min(_matching_counts)) + "-" + str(max(_matching_counts)) + " validated matches each",
    requested_items=_matching_targets,
    file_name="participant-matches.csv",
)
`;
}
