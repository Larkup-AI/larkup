import assert from 'node:assert/strict';
import test from 'node:test';
import { hasRetrievedSourceEvidence } from '../src/lib/chat/media-retrieval-routing.ts';
import {
  extractConversationEvidence,
  imagePreviewInput,
  isImagePreviewFollowUp,
} from '../src/lib/chat/conversation-memory.ts';
import {
  retrievalFallbackMediaAsset,
  type RoutableMediaAsset,
} from '../src/lib/chat/media-source-routing.ts';

const asset: RoutableMediaAsset = {
  id: 'video-1',
  fileName: 'Quarterly product review.mp4',
  processingStatus: 'completed',
  activeVideoKnowledgeRevisionId: 'revision-1',
  type: 'video',
  documentIds: ['document-1'],
};

test('a sole media source is not evidence for an unrelated retrieval miss', () => {
  assert.equal(retrievalFallbackMediaAsset('what is the capital of egypt', [asset]), undefined);
  assert.equal(hasRetrievedSourceEvidence({ query: 'capital of egypt', hits: [] }), false);
});

test('an explicitly named media source remains available after a retrieval miss', () => {
  assert.equal(
    retrievalFallbackMediaAsset('summarize the quarterly product review', [asset])?.id,
    asset.id,
  );
  assert.equal(
    hasRetrievedSourceEvidence({
      hits: [],
      videoEvidence: { mediaAssetId: asset.id, retrievalFallback: 'title-matched-media-source' },
    }),
    true,
  );
});

test('ordinary document hits authorize grounded answer composition', () => {
  assert.equal(hasRetrievedSourceEvidence({ hits: [{ documentId: 'document-1' }] }), true);
});

test('a direct image request reuses the prior PDF page without another search', () => {
  const evidence = extractConversationEvidence([
    {
      role: 'assistant',
      parts: [
        {
          type: 'tool-searchKnowledgeBase',
          input: { query: 'marketing database schema' },
          output: {
            hits: [
              {
                documentId: 'pdf-1',
                title: 'demo.pdf',
                text: 'Marketing database schema',
                images: [{ imageUrl: '/old-derived-image.png', pageNumber: 2, index: 0 }],
              },
            ],
          },
        },
      ],
    },
  ]);

  assert.equal(isImagePreviewFollowUp('I need the image', evidence), true);
  assert.deepEqual(imagePreviewInput(evidence), { documentId: 'pdf-1', pageNumber: 2 });
});

test('an extracted image remains reusable when no PDF page is available', () => {
  const evidence = {
    sources: [],
    images: [{ imageUrl: '/indexed-image.png' }],
    mediaAssetIds: [],
  };
  assert.equal(isImagePreviewFollowUp('show it', evidence), true);
  assert.deepEqual(imagePreviewInput(evidence), { imageUrl: '/indexed-image.png' });
});
