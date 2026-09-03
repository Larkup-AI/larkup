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
 * If retrieved evidence contains an image, inspect it for any substantive
 * question unless the user is explicitly asking to see the image itself.
 * This is source-capability based, not tied to a document type or domain.
 */
export function shouldInspectRetrievedImage(text: string, evidence: unknown): boolean {
  return (
    text.trim().length > 0 &&
    hasRetrievedImageEvidence(evidence) &&
    !requestsImagePresentation(text)
  );
}

/** Generic presentation intent, shared by PDFs, screenshots, scans, and media frames. */
export function requestsImagePresentation(text: string): boolean {
  return /\b(?:show|preview|display|open|view)\b[\s\S]{0,40}\b(?:image|picture|diagram|page|visual|it)\b|\b(?:image|picture|diagram|page|visual)\s+(?:preview|view)\b/i.test(
    text,
  );
}
