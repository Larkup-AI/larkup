import { searchTerms } from './retrieval-ranking';

type ImageDocument = {
  metadata?: { images?: any[]; imageUrl?: unknown; index?: unknown; pageNumber?: unknown };
};

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
  return (
    (typeof record.url === 'string' && /\.pdf(?:$|[?#])/i.test(record.url)) ||
    record.mimeType === 'application/pdf' ||
    Object.values(record).some(hasRetrievedPdfEvidence)
  );
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
  return /\b(?:show|preview|display|open|view)\b[\s\S]{0,40}\b(?:image|picture|diagram|page|visual|it)\b|\b(?:image|picture|diagram|page|visual)\s+(?:preview|view)\b/i.test(
    text,
  );
}
