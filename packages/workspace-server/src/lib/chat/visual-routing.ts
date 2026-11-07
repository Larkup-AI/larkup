import { searchTerms } from './retrieval-ranking';

type ImageDocument = {
  metadata?: { images?: any[]; imageUrl?: unknown; index?: unknown; pageNumber?: unknown };
};

export type RetrievedPdfSource = {
  documentId: string;
  pageNumber?: number;
  title?: string;
};

// A numbered object reference is stronger than a page number attached to a
// vector hit. That hit may be an incidental mention, whereas this is an
// explicit request for an object that the local PDF index can locate by its
// own page text and caption.
const NUMBERED_DOCUMENT_REFERENCE =
  /\b(?:fig(?:ure)?|table|eq(?:uation)?|section|chapter|appendix)\.?\s*(?:no\.?\s*)?\(?\d+(?:\.\d+)*\b/iu;

/** Resolve both current parent-document images and legacy standalone image records. */
export function findIndexedImageSource<T extends ImageDocument>(documents: T[], imageUrl: string) {
  const source = documents.find(
    (document) =>
      (Array.isArray(document.metadata?.images) &&
        document.metadata.images.some((image: any) => image?.imageUrl === imageUrl)) ||
      document.metadata?.imageUrl === imageUrl,
  );
  const image =
    source?.metadata?.images?.find((candidate: any) => candidate?.imageUrl === imageUrl) ??
    (source?.metadata?.imageUrl === imageUrl
      ? {
          imageUrl,
          index: source.metadata.index,
          pageNumber: source.metadata.pageNumber,
        }
      : undefined);
  return image ? { source, image } : undefined;
}

function indexedImageDescriptions(value: unknown): string[] {
  if (typeof value === 'string') {
    try {
      return indexedImageDescriptions(JSON.parse(value));
    } catch {
      return [];
    }
  }
  if (Array.isArray(value)) return value.flatMap(indexedImageDescriptions);
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const here = Array.isArray(record.images)
    ? record.images.flatMap((image) => {
        if (!image || typeof image !== 'object') return [];
        const description = (image as { description?: unknown }).description;
        return typeof description === 'string' && description.trim() ? [description] : [];
      })
    : [];
  return [...here, ...Object.values(record).flatMap(indexedImageDescriptions)];
}

/** Recognizes image-bearing retrieval results, including compact JSON envelopes. */
export function hasRetrievedImageEvidence(value: unknown): boolean {
  if (typeof value === 'string') {
    try {
      return hasRetrievedImageEvidence(JSON.parse(value));
    } catch {
      return false;
    }
  }
  if (Array.isArray(value)) return value.some(hasRetrievedImageEvidence);
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.images) && record.images.length > 0) return true;
  return Object.values(record).some(hasRetrievedImageEvidence);
}

/** Finds a PDF source returned by retrieval, even when it has no pre-indexed images. */
export function hasRetrievedPdfEvidence(value: unknown): boolean {
  if (findRetrievedPdfSource(value)) return true;
  if (typeof value === 'string') {
    try {
      return hasRetrievedPdfEvidence(JSON.parse(value));
    } catch {
      return false;
    }
  }
  if (Array.isArray(value)) return value.some(hasRetrievedPdfEvidence);
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  const metadata =
    record.metadata && typeof record.metadata === 'object'
      ? (record.metadata as Record<string, unknown>)
      : undefined;
  return (
    (typeof record.url === 'string' && /\.pdf(?:$|[?#])/i.test(record.url)) ||
    (typeof record.title === 'string' && /\.pdf(?:$|[?#])/i.test(record.title)) ||
    record.mimeType === 'application/pdf' ||
    metadata?.mimeType === 'application/pdf' ||
    metadata?.fileKind === 'pdf' ||
    (typeof metadata?.originalFile === 'string' &&
      /\.pdf(?:$|[?#])/i.test(metadata.originalFile)) ||
    Object.values(record).some(hasRetrievedPdfEvidence)
  );
}

function positivePageNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

/** Whether the request names a stable, numbered object inside a document. */
export function hasNumberedDocumentReference(text: string): boolean {
  return NUMBERED_DOCUMENT_REFERENCE.test(text);
}

/** Return the nearest named document object from a chronological text history. */
export function latestNumberedDocumentReferenceText(texts: readonly string[]): string | undefined {
  for (let index = texts.length - 1; index >= 0; index -= 1) {
    if (hasNumberedDocumentReference(texts[index])) return texts[index];
  }
  return undefined;
}

/**
 * An explicit document reference must be ranked against the original PDF.
 * Otherwise, a page attached to the retrieval hit is an efficient exact hint.
 */
export function preferredPdfPagesForInspection(
  retrievedPageNumber: number | undefined,
  question: string,
): number[] | undefined {
  if (hasNumberedDocumentReference(question)) return undefined;
  return retrievedPageNumber ? [retrievedPageNumber] : undefined;
}

function pdfSourceFromRecord(value: unknown): RetrievedPdfSource | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, any>;
  if (typeof record.documentId !== 'string' || !record.documentId) return undefined;
  const metadata = record.metadata && typeof record.metadata === 'object' ? record.metadata : {};
  const isPdf =
    (typeof record.url === 'string' && /\.pdf(?:$|[?#])/i.test(record.url)) ||
    (typeof record.title === 'string' && /\.pdf(?:$|[?#])/i.test(record.title)) ||
    record.mimeType === 'application/pdf' ||
    metadata.mimeType === 'application/pdf' ||
    metadata.fileKind === 'pdf' ||
    (typeof metadata.originalFile === 'string' && /\.pdf(?:$|[?#])/i.test(metadata.originalFile));
  if (!isPdf) return undefined;
  return {
    documentId: record.documentId,
    pageNumber: positivePageNumber(record.pageNumber) ?? positivePageNumber(metadata.pageNumber),
    title: typeof record.title === 'string' ? record.title : undefined,
  };
}

/**
 * Select the leading PDF source returned by retrieval. A direct visual chunk
 * carries its page number, so it is preferred over a document-level text
 * chunk that would otherwise make a preview fall back to page one.
 */
export function findRetrievedPdfSource(
  value: unknown,
  question = '',
): RetrievedPdfSource | undefined {
  if (typeof value === 'string') {
    try {
      return findRetrievedPdfSource(JSON.parse(value), question);
    } catch {
      return undefined;
    }
  }
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const hits = Array.isArray(record.hits) ? record.hits : [];
  const sources = hits.map(pdfSourceFromRecord).filter(Boolean) as RetrievedPdfSource[];
  if (sources.length === 0) return undefined;
  const questionTerms = new Set(
    (question.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((term) => term.length > 2),
  );
  const scored = sources.map((source) => ({
    source,
    matches: (source.title?.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
      .filter((term) => term.length > 2 && term !== 'pdf')
      .filter((term) => questionTerms.has(term)).length,
  }));
  const bestMatch = scored.reduce((best, current) =>
    current.matches > best.matches ? current : best,
  );
  const chosen = bestMatch.matches >= 2 ? bestMatch.source : sources[0];
  return (
    sources.find(
      (source) => source.documentId === chosen.documentId && source.pageNumber !== undefined,
    ) ?? chosen
  );
}

/** A PDF may refer the requested numeric fact to a figure even when the user does not say "figure". */
export function inspectedPdfNeedsVisualReading(question: string, value: unknown): boolean {
  if (requiresPdfVisualAnalysis(question)) return true;
  if (
    !/\b(?:which|highest|lowest|largest|smallest|exceed|threshold|how many|count|value|rate|per\s+subject)\b/iu.test(
      question,
    )
  )
    return false;
  if (!value || typeof value !== 'object') return false;
  const pages = (value as { pages?: Array<{ text?: unknown }> }).pages;
  return (
    Array.isArray(pages) &&
    pages.some(
      (page) =>
        typeof page.text === 'string' &&
        /\b(?:figure|chart|graph|plot|diagram)\s*\d+\b/iu.test(page.text),
    )
  );
}

/** Keep a single visual claim on its highest-ranked page; extra pages can introduce unrelated values. */
export function pdfPagesForVisualAnalysis(question: string, rankedPages: number[]): number[] {
  const references = new Set(
    [
      ...question.matchAll(/\b(?:fig(?:ure)?|table|chart|graph|diagram)\s*(\d+(?:\.\d+)*)\b/giu),
    ].map((match) => match[1]),
  );
  return references.size > 1 ||
    /\b(?:across|between|compare)\s+(?:the\s+)?(?:pages|figures|charts|tables)\b/iu.test(question)
    ? rankedPages.slice(0, 3)
    : rankedPages.slice(0, 1);
}

/** Reject a single-entity table result that contradicts an explicitly read PDF visual label. */
export function visualEntityMismatch(
  question: string,
  pdfAnalysis: unknown,
  resultText: string,
): string | undefined {
  if (
    !/\b(?:which|what)\b[\s\S]{0,100}\b(?:site|record|subject|group|cohort|arm|item)\b/iu.test(
      question,
    )
  )
    return undefined;
  if (!pdfAnalysis || typeof pdfAnalysis !== 'object') return undefined;
  const pages = (pdfAnalysis as { pages?: Array<{ analysis?: unknown }> }).pages;
  if (!Array.isArray(pages)) return undefined;
  const labels = new Set(
    pages.flatMap((page) =>
      typeof page.analysis === 'string'
        ? [
            ...page.analysis.matchAll(
              /\b(?:site|record|subject|group|cohort|arm|item)\s*(?:id)?\s*(?:\*{0,2}:?\*{0,2}\s*)?([A-Z]{1,6}[-_]?\d{1,8})\b/giu,
            ),
          ].map((match) => match[1].toUpperCase())
        : [],
    ),
  );
  if (labels.size !== 1) return undefined;
  const expected = [...labels][0];
  const prefix = expected.match(/^[A-Z]{1,6}[-_]?/u)?.[0];
  if (!prefix) return undefined;
  const resultIds = new Set(
    [...resultText.toUpperCase().matchAll(/\b[A-Z]{1,6}[-_]?\d{1,8}\b/gu)]
      .map((match) => match[0])
      .filter((id) => id.startsWith(prefix)),
  );
  if (resultIds.size === 1 && !resultIds.has(expected)) {
    return `The PDF visual identifies ${expected}, but the calculation returned ${[...resultIds][0]}. Recalculate from the uploaded table using the PDF identifier and value; do not reconstruct table rows.`;
  }
  return undefined;
}

/** Check a stated per-person rate against an explicit PDF count and table denominator. */
export function visualRateMismatch(
  question: string,
  pdfAnalysis: unknown,
  resultText: string,
): string | undefined {
  const intent = question.match(
    /\b([a-z]+)\s+per\s+(?:randomi[sz]ed\s+)?(subject|patient|participant|record|site)\b/iu,
  );
  if (!intent || !pdfAnalysis || typeof pdfAnalysis !== 'object') return undefined;
  const pages = (pdfAnalysis as { pages?: Array<{ analysis?: unknown }> }).pages;
  if (!Array.isArray(pages)) return undefined;
  const visualText = pages
    .map((page) => (typeof page.analysis === 'string' ? page.analysis : ''))
    .join('\n');
  const metric = intent[1].toLocaleLowerCase();
  const resultIds = new Set(
    [...resultText.toUpperCase().matchAll(/\b[A-Z]{1,6}[-_]?\d{1,8}\b/gu)].map((match) => match[0]),
  );
  const countPattern = new RegExp(`\\b(\\d+(?:\\.\\d+)?)\\s+(?:total\\s+)?${metric}\\b`, 'giu');
  const sourceCounts = visualText
    .split(/\n|[.!?](?=\s|$)/u)
    .filter(
      (statement) =>
        resultIds.size === 0 ||
        (resultIds.size === 1 && new RegExp(`\\b${[...resultIds][0]}\\b`, 'iu').test(statement)),
    )
    .flatMap((statement) => [...statement.matchAll(countPattern)].map((match) => Number(match[1])));
  if (new Set(sourceCounts).size !== 1) return undefined;
  const denominator = resultText.match(
    /\b(?:enrollment|randomi[sz]ed[_ ]?subjects?|total[_ ]?subjects?|subject[_ ]?count)\s*[:=]\s*(?:np\.int64\()?\s*(\d+(?:\.\d+)?)/iu,
  );
  const rateKey = new RegExp(
    `\\b${metric}_per_(?:randomi[sz]ed_)?${intent[2]}\\s*[:=]\\s*(?:np\\.float64\\()?\\s*(\\d+(?:\\.\\d+)?)`,
    'iu',
  );
  const reportedRate = resultText.match(rateKey);
  if (sourceCounts.length === 0 || !denominator || !reportedRate) return undefined;
  const count = sourceCounts[0];
  const population = Number(denominator[1]);
  const reported = Number(reportedRate[1]);
  if (population <= 0 || !Number.isFinite(count / population)) return undefined;
  return Math.abs(reported - count / population) > Math.max(0.02, (count / population) * 0.02)
    ? `The reported ${metric}-per-${intent[2]} rate conflicts with the sources: ${count} / ${population} = ${(count / population).toFixed(4)}. Recalculate from the verified numerator and denominator.`
    : undefined;
}

/** Carry a single PDF identifier and its explicitly stated numerator into the final calculation result. */
export function visualEntityEvidenceLine(
  question: string,
  pdfAnalysis: unknown,
): string | undefined {
  if (
    !/\b(?:which|what)\b[\s\S]{0,100}\b(?:site|record|subject|group|cohort|arm|item)\b/iu.test(
      question,
    )
  )
    return undefined;
  if (!pdfAnalysis || typeof pdfAnalysis !== 'object') return undefined;
  const pages = (pdfAnalysis as { pages?: Array<{ analysis?: unknown }> }).pages;
  if (!Array.isArray(pages)) return undefined;
  const text = pages
    .map((page) => (typeof page.analysis === 'string' ? page.analysis : ''))
    .join('\n');
  const ids = new Set(
    [
      ...text.matchAll(
        /\b(?:site|record|subject|group|cohort|arm|item)\s*(?:id)?\s*(?:\*{0,2}:?\*{0,2}\s*)?([A-Z]{1,6}[-_]?\d{1,8})\b/giu,
      ),
    ].map((match) => match[1].toUpperCase()),
  );
  if (ids.size !== 1) return undefined;
  const id = [...ids][0];
  const metric = question.match(
    /\b([a-z]+)\s+per\s+(?:randomi[sz]ed\s+)?(?:subject|patient|participant|record|site)\b/iu,
  )?.[1];
  const count = metric
    ? text.match(new RegExp(`\\b(\\d+(?:\\.\\d+)?)\\s+(?:total\\s+)?${metric}\\b`, 'iu'))?.[1]
    : undefined;
  return `Verified PDF visual: ${id}${count && metric ? `; ${count} ${metric}` : ''}.`;
}

/** Compute a comparable population gap from a PDF plot n and a filtered table count. */
export function pdfPlotTabularCountDifference(
  question: string,
  pdfAnalysis: unknown,
  tabularOutput: unknown,
  queryInput: unknown,
): { plotN: number; tableCount: number; difference: number; plotPopulation?: string } | undefined {
  if (!/\b(?:plot|figure|chart)\b[\s\S]{0,220}\b(?:n|count|number|differ)\b/iu.test(question))
    return undefined;
  if (
    !pdfAnalysis ||
    typeof pdfAnalysis !== 'object' ||
    !tabularOutput ||
    typeof tabularOutput !== 'object'
  )
    return undefined;
  const pages = (pdfAnalysis as { pages?: Array<{ analysis?: unknown }> }).pages;
  const output = tabularOutput as { totalRows?: unknown };
  const input = queryInput as
    | {
        aggregations?: Array<{ op?: unknown }>;
        filters?: Array<{ column?: string; op?: string; value?: unknown }>;
      }
    | undefined;
  if (!Array.isArray(pages) || !input?.aggregations?.some((item) => item.op === 'count'))
    return undefined;
  const text = pages
    .map((page) => (typeof page.analysis === 'string' ? page.analysis : ''))
    .join('\n');
  const labeledCounts = [...text.matchAll(/^([^\n]{0,160}?)\bn\s*=\s*(\d[\d,]*)\b/gimu)].map(
    (match) => ({ label: match[1], n: Number(match[2].replaceAll(',', '')) }),
  );
  const filterMatchesLabel = (
    label: string,
    filter: { column?: string; op?: string; value?: unknown },
  ) => {
    if (!filter.column || filter.value === undefined) return false;
    const normalized = label.toLocaleLowerCase();
    const column = filter.column.replaceAll('_', ' ').toLocaleLowerCase();
    if (
      !normalized.includes(column) ||
      !normalized.includes(String(filter.value).toLocaleLowerCase())
    )
      return false;
    const operator = filter.op;
    return operator === 'gte'
      ? /≥|>=|at least/iu.test(label)
      : operator === 'gt'
        ? />|greater than/iu.test(label)
        : operator === 'lte'
          ? /≤|<=|at most/iu.test(label)
          : operator === 'lt'
            ? /<|less than/iu.test(label)
            : operator === 'eq'
              ? true
              : false;
  };
  const matched = labeledCounts.filter(
    (row) =>
      (input.filters ?? []).length > 0 &&
      (input.filters ?? []).every((filter) => filterMatchesLabel(row.label, filter)),
  );
  const selected =
    matched.length === 1 ? matched[0] : labeledCounts.length === 1 ? labeledCounts[0] : undefined;
  const plotN = selected?.n;
  const tableCount = output.totalRows;
  if (
    !Number.isSafeInteger(plotN) ||
    !plotN ||
    plotN <= 0 ||
    !Number.isSafeInteger(tableCount) ||
    Number(tableCount) < 0
  )
    return undefined;
  return {
    plotN,
    tableCount: Number(tableCount),
    difference: Number(tableCount) - plotN,
    ...(/\bcompleters?\b/iu.test(text) ? { plotPopulation: 'completers' } : {}),
  };
}

/** After a fresh visual read, keep source locators but discard older OCR snippets that may conflict. */
export function prioritizeFreshPdfVisualEvidence(value: unknown, selectedPages: number[]): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, any>;
  if (!Array.isArray(record.pdfVisualAnalysis?.pages) || record.pdfVisualAnalysis.success !== true)
    return value;
  return {
    ...record,
    hits: Array.isArray(record.hits)
      ? record.hits.map((hit: any) => ({
          documentId: hit.documentId,
          title: hit.title,
          url: hit.url,
          score: hit.score,
          metadata: hit.metadata,
        }))
      : record.hits,
    pdfInspection:
      record.pdfInspection && typeof record.pdfInspection === 'object'
        ? {
            ...record.pdfInspection,
            pages: Array.isArray(record.pdfInspection.pages)
              ? record.pdfInspection.pages.filter((page: any) =>
                  selectedPages.includes(page.pageNumber),
                )
              : record.pdfInspection.pages,
          }
        : record.pdfInspection,
  };
}

/**
 * Reuse relevant descriptions produced during image indexing, and reserve a
 * fresh vision pass for details those descriptions do not cover.
 */
export function shouldInspectRetrievedImage(text: string, evidence: unknown): boolean {
  if (!text.trim() || !hasRetrievedImageEvidence(evidence) || requestsImagePresentation(text)) {
    return false;
  }

  // Captions are useful for orientation, but they cannot prove an exhaustive
  // visual request. A diagram question that asks for every label, a count, or
  // an exact name must receive one bounded image read; otherwise a partial
  // caption can make the assistant confidently omit the information the user
  // actually asked it to enumerate.
  if (
    /\b(?:every|all|each|list|enumerate|count|how many|number of)\b|\b(?:view|routine|table|column|field|label|name)s?\b/i.test(
      text,
    )
  ) {
    return true;
  }

  const descriptions = indexedImageDescriptions(evidence).join(' ').toLocaleLowerCase();
  if (!descriptions) return true;
  const terms = searchTerms(text);
  const matched = terms.filter((term) => descriptions.includes(term)).length;

  // Image indexing already performed the expensive visual read. Reuse it when
  // the stored description substantially covers this question; only reopen a
  // vision call when the retrieval note does not address the requested detail.
  return terms.length > 0 && matched / terms.length < 0.35;
}

/** Generic presentation intent, shared by PDFs, screenshots, scans, and media frames. */
export function requestsImagePresentation(text: string): boolean {
  return /\b(?:show|preview|display|open|view|see|need|give|provide|render)\b[\s\S]{0,40}\b(?:image|picture|diagram|page|visual|figure|it)\b|\b(?:image|picture|diagram|page|visual|figure)\s+(?:preview|view)\b/i.test(
    text,
  );
}

/**
 * Page text is enough for ordinary prose. These requests explicitly depend on
 * page layout, notation, or a visual object, so a rendered-page read is the
 * higher-fidelity source of truth. The language is document-generic rather
 * than tied to any particular paper or diagram format.
 */
export function requiresPdfVisualAnalysis(text: string): boolean {
  return /\b(?:figure|fig\.?|diagram|chart|graph|image|picture|visual|table|equation|formula|notation|layout|caption|legend|label|matrix|kaplan[ -]meier|at[ -]risk)\b|\\(?:frac|sqrt|sum|alpha|beta|gamma|delta|theta|[()[\]{}])|[∂∑√ᵀ]/i.test(
    text,
  );
}
