import { expect, test } from '@playwright/test';
import { chunkDocument } from '../../../packages/core/src/indexing/chunker';

test('creates retrievable image chunks with their descriptions and stored URLs', () => {
  const chunks = chunkDocument(
    {
      id: 'pdf-with-images',
      title: 'architecture.pdf',
      content: 'A short PDF introduction.',
      source: 'files',
      charCount: 25,
      createdAt: new Date(0).toISOString(),
      metadata: {
        images: [
          {
            imageUrl: '/api/uploads/architecture-1.jpg',
            pageNumber: 2,
            index: 3,
            description: 'An architecture diagram showing the ingestion pipeline.',
          },
        ],
      },
    },
    { chunkSize: 512, chunkOverlap: 0, strategy: 'recursive' },
  );

  expect(chunks).toContainEqual(
    expect.objectContaining({
      id: 'pdf-with-images#img3',
      text: 'An architecture diagram showing the ingestion pipeline.',
      url: '/api/uploads/architecture-1.jpg',
      metadata: expect.objectContaining({
        isImage: true,
        imageUrl: '/api/uploads/architecture-1.jpg',
      }),
    }),
  );
});
