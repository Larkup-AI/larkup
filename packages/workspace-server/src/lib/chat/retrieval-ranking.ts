const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'be',
  'by',
  'do',
  'for',
  'from',
  'how',
  'i',
  'in',
  'is',
  'it',
  'list',
  'me',
  'of',
  'on',
  'or',
  'show',
  'tell',
  'that',
  'the',
  'this',
  'to',
  'under',
  'was',
  'what',
  'when',
  'which',
  'who',
  'with',
]);

export function searchTerms(text: string): string[] {
  return [
    ...new Set(
      text
        .toLocaleLowerCase()
        .match(/[\p{L}\p{N}_-]+/gu)
        ?.filter((term) => term.length > 1 && !STOP_WORDS.has(term)) ?? [],
    ),
  ];
}

// A plain substring check turns a short query term into a false hit inside
// any longer word that happens to contain it as a fragment -- "day" inside
// "Tuesday", "color" inside "Colored" -- which systematically favors long,
// generic documents over a short, genuinely on-topic one. Word-boundary
// matching (Unicode-aware, so non-Latin scripts aren't broken) keeps the
// coverage signal tied to the term actually appearing as its own word --
// tolerating a trailing plural/possessive suffix (view/views, routine/
// routines) so a strict boundary doesn't overcorrect into missing ordinary
// inflection, which "day"/"color" above are not instances of.
function termMatcher(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?:'s|es|s)?(?![\\p{L}\\p{N}])`, 'u');
}

export interface QueryTermMatcher {
  term: string;
  regex: RegExp;
}

/**
 * Extracts a query's significant terms and compiles their matchers once, so
 * a caller scanning many candidates (e.g. every document's title) doesn't
 * redo term extraction and regex compilation on every single one of them.
 */
export function buildQueryTermMatchers(query: string): QueryTermMatcher[] {
  return searchTerms(query).map((term) => ({ term, regex: termMatcher(term) }));
}

/** How many of a precomputed set of query-term matchers appear (word-boundary
 * aware) in `text`. */
export function countMatchesIn(matchers: QueryTermMatcher[], text: string): number {
  if (matchers.length === 0) return 0;
  const normalized = text.toLocaleLowerCase();
  return matchers.filter(({ regex }) => regex.test(normalized)).length;
}

/**
 * How many of the query's significant terms appear (word-boundary aware) in
 * `title`. Exposed so a candidate-pool builder can pull in a document whose
 * title is an obvious match for the query even when pure vector similarity
 * placed it outside the retrieved pool entirely -- reranking can only
 * reorder what's already in the pool, it can't recover a document that
 * never made it in. Scanning many titles for the same query should use
 * `buildQueryTermMatchers` once and call `countMatchesIn` per title instead
 * of this convenience wrapper, which redoes both on every call.
 */
export function countTitleTermMatches(query: string, title: string): number {
  return countMatchesIn(buildQueryTermMatchers(query), title);
}

/** Merge semantic recall with exact terminology from names, labels, and IDs. */
export function rankKnowledgeHits<T extends { text?: string; title?: string; metadata?: any }>(
  query: string,
  hits: T[],
): T[] {
  const matchers = buildQueryTermMatchers(query);
  if (matchers.length === 0 || hits.length < 2) return hits;

  const phrase = query.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
  return hits
    .map((hit, denseRank) => {
      const searchable = [
        hit.title,
        hit.text,
        hit.metadata?.description,
        hit.metadata?.originalFile,
      ]
        .filter((value): value is string => typeof value === 'string')
        .join(' ')
        .toLocaleLowerCase();
      const coverage = countMatchesIn(matchers, searchable) / matchers.length;
      const title = hit.title?.toLocaleLowerCase();
      const titleMatches = title ? countMatchesIn(matchers, title) : 0;
      const phraseBonus = phrase.length > 3 && searchable.includes(phrase) ? 0.2 : 0;
      const score = 0.35 / (denseRank + 1) + coverage + titleMatches * 0.08 + phraseBonus;
      return { hit, score, denseRank };
    })
    .sort((left, right) => right.score - left.score || left.denseRank - right.denseRank)
    .map(({ hit }) => hit);
}
