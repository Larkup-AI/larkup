import { describe, expect, it } from 'vitest';
import {
  hasRetrievedImageEvidence,
  hasRetrievedPdfEvidence,
  hasNumberedDocumentReference,
  findRetrievedPdfSource,
  findIndexedImageSource,
  latestNumberedDocumentReferenceText,
  preferredPdfPagesForInspection,
  requiresPdfVisualAnalysis,
  requestsImagePresentation,
  shouldInspectRetrievedImage,
} from './visual-routing';

describe('PDF visual routing', () => {
  it('resolves previews from legacy standalone indexed-image records', () => {
    expect(
      findIndexedImageSource(
        [
          {
            metadata: {
              imageUrl: '/api/uploads/schema.png',
              pageNumber: 3,
              index: 0,
            },
          },
        ],
        '/api/uploads/schema.png',
      ),
    ).toMatchObject({ image: { pageNumber: 3, index: 0 } });
  });

  it('visually verifies exhaustive diagram requests instead of trusting a partial caption', () => {
    expect(
      shouldInspectRetrievedImage(
        "list every view and routine name shown, and tell me how many routines are under 'Resources'.",
        {
          hits: [
            {
              images: [
                {
                  imageUrl: '/api/uploads/schema.png',
                  description:
                    'Views: film_list and staff_list. Resources routines: get_customer and film_in_stock.',
                },
              ],
            },
          ],
        },
      ),
    ).toBe(true);
  });

  it('requires a fresh visual read when indexed descriptions do not cover the question', () => {
    expect(
      shouldInspectRetrievedImage('What color is the connector between the billing tables?', {
        hits: [
          {
            images: [
              {
                imageUrl: '/api/uploads/schema.png',
                description: 'A database overview with user account labels.',
              },
            ],
          },
        ],
      }),
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

  it('prefers the matched visual page over an earlier document image', () => {
    expect(
      findRetrievedPdfSource({
        hits: [
          { documentId: 'paper', title: 'paper.pdf', url: '/api/uploads/paper.pdf' },
          {
            documentId: 'paper',
            title: 'paper.pdf - Page 17',
            url: '/api/uploads/paper.pdf',
            metadata: { isImage: true, pageNumber: 17 },
          },
        ],
      }),
    ).toEqual({ documentId: 'paper', pageNumber: 17, title: 'paper.pdf - Page 17' });
  });

  it('uses rendered-page analysis for layout-dependent document requests', () => {
    expect(requiresPdfVisualAnalysis('Explain the two panels in Figure 3.1.')).toBe(true);
    expect(requiresPdfVisualAnalysis('Write the \"softmax(QKᵀ/√dₖ)V\" formula.')).toBe(true);
    expect(requiresPdfVisualAnalysis('Summarize the introduction.')).toBe(false);
  });

  it('recognizes render requests as image presentation', () => {
    expect(requestsImagePresentation('can you render it here?')).toBe(true);
  });

  it('lets the local PDF index resolve an explicit numbered object reference', () => {
    expect(hasNumberedDocumentReference('Please render Figure 2.1 here.')).toBe(true);
    expect(hasNumberedDocumentReference('Compare Table 3.1.')).toBe(true);
    expect(hasNumberedDocumentReference('Write Eq. (2.24).')).toBe(true);
    expect(preferredPdfPagesForInspection(43, 'Please render Figure 2.1 here.')).toBeUndefined();
  });

  it('keeps a retrieved page hint when the user did not name a document object', () => {
    expect(preferredPdfPagesForInspection(43, 'Please render that page here.')).toEqual([43]);
  });

  it('retains the nearest named object for a later deictic preview request', () => {
    expect(
      latestNumberedDocumentReferenceText([
        'What does Figure 2.1 show?',
        'It is the vectorized attention flow.',
        'Can you render it here?',
      ]),
    ).toBe('What does Figure 2.1 show?');
  });
});
