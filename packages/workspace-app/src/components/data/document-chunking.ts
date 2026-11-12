// Pure, dependency-free helpers for keeping uploaded document content within the
// documents API limit. Extracted from the upload panel so it can be unit-tested
// without loading the client component and its browser-only dependencies.

// The documents API rejects content longer than 750k characters. Split oversized
// documents into ordered parts below that cap so large files (big CSVs/sheets,
// long text, or image-rich PDFs) are stored instead of silently failing.
export const MAX_DOCUMENT_CONTENT = 700_000;

export interface DocumentPayload {
  title: string;
  content: string;
  source: string;
  url?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Break a document whose content exceeds the server cap into ordered parts,
 * preferring line boundaries so structured rows and paragraphs stay intact.
 * Returns the payload unchanged when it already fits.
 */
export function splitDocumentPayload(
  payload: DocumentPayload,
  max = MAX_DOCUMENT_CONTENT,
): DocumentPayload[] {
  if (payload.content.length <= max) return [payload];
  const segments: string[] = [];
  let current = '';
  for (const line of payload.content.split('\n')) {
    // A single line longer than the cap is hard-sliced as a last resort.
    if (line.length > max) {
      if (current) {
        segments.push(current);
        current = '';
      }
      for (let i = 0; i < line.length; i += max) segments.push(line.slice(i, i + max));
      continue;
    }
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > max) {
      if (current) segments.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current) segments.push(current);

  const total = segments.length;
  return segments.map((content, index) => ({
    ...payload,
    title: total > 1 ? `${payload.title} (part ${index + 1} of ${total})` : payload.title,
    content,
    metadata: {
      ...payload.metadata,
      ...(total > 1 ? { part: index + 1, partCount: total } : {}),
    },
  }));
}
