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

type VisualPdfDocument = {
  id: string;
  title: string;
  content: string;
  status?: string;
  url?: string;
  metadata?: {
    mimeType?: unknown;
    fileKind?: unknown;
    images?: unknown;
  };
};

function visualPdfSearchText(document: VisualPdfDocument): string {
  const imageDescriptions = Array.isArray(document.metadata?.images)
    ? document.metadata.images.flatMap((image) => {
        if (!image || typeof image !== 'object') return [];
        const description = (image as { description?: unknown }).description;
        return typeof description === 'string' ? [description] : [];
      })
    : [];
  return [document.title, document.content, ...imageDescriptions].join(' ');
}

/**
 * Recover a visual PDF when dense rows from a large table crowd it out of the
 * semantic candidate pool. Older PDFs may have text but no indexed images;
 * their original pages can still be rendered for visual verification.
 */
export function selectVisualPdfFallbackDocuments<T extends VisualPdfDocument>(
  query: string,
  documents: T[],
  maximum = 2,
): T[] {
  const matchers = buildQueryTermMatchers(query);
  if (matchers.length === 0) return [];
  const minimumMatches = Math.min(3, Math.max(2, Math.ceil(matchers.length * 0.25)));
  const candidates = documents
    .filter(
      (document) =>
        document.status === 'indexed' &&
        (document.metadata?.fileKind === 'pdf' ||
          document.metadata?.mimeType === 'application/pdf' ||
          /\.pdf$/iu.test(document.title)) &&
        Boolean(document.content.trim() || document.metadata?.images),
    )
    .map((document) => {
      const searchable = visualPdfSearchText(document).toLocaleLowerCase();
      return {
        document,
        matchedTerms: matchers
          .filter(({ regex }) => regex.test(searchable))
          .map(({ term }) => term),
      };
    });
  const frequency = new Map(
    matchers.map(({ term }) => [
      term,
      candidates.filter((candidate) => candidate.matchedTerms.includes(term)).length,
    ]),
  );
  return candidates
    .filter((candidate) => candidate.matchedTerms.length >= minimumMatches)
    .map((candidate) => ({
      ...candidate,
      score: candidate.matchedTerms.reduce(
        (total, term) =>
          total + Math.log((candidates.length + 1) / ((frequency.get(term) ?? 0) + 1)) + 1,
        0,
      ),
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.matchedTerms.length - left.matchedTerms.length ||
        left.document.title.localeCompare(right.document.title),
    )
    .slice(0, maximum)
    .map((candidate) => candidate.document);
}

/** Keep one relevant document source when table chunks fill a mixed visual query. */
export function retainPreferredPdfHit<T extends { documentId: string }>(
  selected: T[],
  ranked: T[],
  preferredDocumentIds: readonly string[],
  maximum: number,
): T[] {
  if (maximum < 1) return selected;
  const bestId = preferredDocumentIds.find((id) => ranked.some((hit) => hit.documentId === id));
  if (!bestId || selected.some((hit) => hit.documentId === bestId)) return selected;
  const pdf = ranked.find((hit) => hit.documentId === bestId);
  if (!pdf) return selected;
  return selected.length < maximum ? [...selected, pdf] : [...selected.slice(0, -1), pdf];
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
