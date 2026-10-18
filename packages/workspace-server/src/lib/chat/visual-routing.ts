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
  /\b(?:fig(?:ure)?|table|eq(?:uation)?|section|chapter|appendix)\.?\s*(?:no\.?\s*)?\(?\d+(?:\.\d+)+\b/iu;

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
export function findRetrievedPdfSource(value: unknown): RetrievedPdfSource | undefined {
  if (typeof value === 'string') {
    try {
      return findRetrievedPdfSource(JSON.parse(value));
    } catch {
      return undefined;
    }
  }
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const hits = Array.isArray(record.hits) ? record.hits : [];
  const sources = hits.map(pdfSourceFromRecord).filter(Boolean) as RetrievedPdfSource[];
  return sources.find((source) => source.pageNumber !== undefined) ?? sources[0];
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
  return /\b(?:figure|fig\.?|diagram|chart|graph|image|picture|visual|table|equation|formula|notation|layout|caption|legend|label|matrix)\b|\\(?:frac|sqrt|sum|alpha|beta|gamma|delta|theta|[()[\]{}])|[∂∑√ᵀ]/i.test(
    text,
  );
}
