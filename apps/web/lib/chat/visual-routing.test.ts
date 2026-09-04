import { describe, expect, it } from 'vitest';
import {
  hasRetrievedImageEvidence,
  hasRetrievedPdfEvidence,
  findIndexedImageSource,
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

  it('reuses a relevant indexed image description without another slow vision pass', () => {
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
    ).toBe(false);
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
});
