import { describe, expect, it } from 'vitest';
import {
  hasRetrievedImageEvidence,
  hasRetrievedPdfEvidence,
  requestsImagePresentation,
  shouldInspectRetrievedImage,
} from './visual-routing';

describe('PDF visual routing', () => {
  it('requires a vision pass for any substantive question with image evidence', () => {
    expect(
      shouldInspectRetrievedImage(
        "list every view and routine name shown, and tell me how many routines are under 'Resources'.",
        { hits: [{ images: [{ imageUrl: '/api/uploads/schema.png' }] }] },
      ),
    ).toBe(true);
  });

  it('routes an explicit visual preview to presentation instead of analysis', () => {
    expect(requestsImagePresentation('show me diagram preview')).toBe(true);
    expect(
      shouldInspectRetrievedImage('show me diagram preview', {
        hits: [{ images: [{ imageUrl: '/api/uploads/schema.png' }] }],
      }),
    ).toBe(false);
  });

  it('recognizes an extracted PDF image in a compact retrieval result', () => {
    expect(
      hasRetrievedImageEvidence({
        hits: [{ images: [{ imageUrl: '/api/uploads/schema.png', pageNumber: 2 }] }],
      }),
    ).toBe(true);
  });

  it('recognizes a retrieved PDF even if no images were indexed', () => {
    expect(
      hasRetrievedPdfEvidence({ hits: [{ documentId: 'doc-1', url: '/api/uploads/source.pdf' }] }),
    ).toBe(true);
  });
});
