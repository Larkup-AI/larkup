import assert from 'node:assert/strict';
import test from 'node:test';
import { hasRetrievedSourceEvidence } from '../src/lib/chat/media-retrieval-routing.ts';
import {
  extractConversationEvidence,
  extractLatestAnalysisArtifact,
  extractLatestTabularExportResult,
  imagePreviewInput,
  isAnalysisArtifactFollowUp,
  isDirectTabularPresentationFollowUp,
  isImagePreviewFollowUp,
} from '../src/lib/chat/conversation-memory.ts';
import {
  retrievalFallbackMediaAsset,
  type RoutableMediaAsset,
} from '../src/lib/chat/media-source-routing.ts';
import { formatObservedAppearanceAnswer } from '../src/lib/chat/tool-context.ts';

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

test('a direct image request reuses a page selected by PDF inspection', () => {
  const evidence = extractConversationEvidence([
    {
      role: 'assistant',
      parts: [
        {
          type: 'tool-searchKnowledgeBase',
          input: { query: 'What does the schema include?' },
          output: {
            hits: [{ documentId: 'pdf-1', title: 'Schema.pdf', text: 'Database schema details' }],
          },
        },
        {
          type: 'tool-inspectPdfPages',
          input: { documentId: 'pdf-1', question: 'What does the schema include?' },
          output: { success: true, pages: [{ pageNumber: 2 }] },
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

test('a derived follow-up can reuse every row from the preceding generated table', () => {
  const rows = Array.from({ length: 650 }, (_, index) => ({
    participant: `Participant ${Math.floor(index / 3) + 1}`,
    match: `Match ${index + 1}`,
  }));
  const messages = [
    {
      role: 'assistant',
      parts: [
        {
          type: 'tool-queryTabularData',
          input: { datasetId: 'participants' },
          output: {
            columns: ['participant', 'match'],
            rows: rows.slice(0, 20),
            totalRows: 268,
          },
        },
        {
          type: 'tool-executeAnalysis',
          input: { code: '...' },
          output: {
            exitCode: 0,
            presentation: {
              kind: 'table',
              title: 'Participant matches',
              columns: ['participant', 'match'],
              rows,
              totalItems: rows.length,
              complete: true,
            },
          },
        },
      ],
    },
  ];

  const artifact = extractLatestAnalysisArtifact(messages);
  const table = extractLatestTabularExportResult(messages);
  assert.equal(
    isAnalysisArtifactFollowUp(
      'Use the matches it created and calculate the number of matches for every participant.',
      artifact,
    ),
    true,
  );
  assert.equal(table?.rows.length, 650);
  assert.deepEqual(table?.rows.at(-1), rows.at(-1));
});

test('an unrelated calculation does not silently reuse a generated table', () => {
  assert.equal(
    isAnalysisArtifactFollowUp('Calculate the average age in the uploaded participant list.', {
      kind: 'table',
      title: 'Participant matches',
      totalItems: 650,
      complete: true,
    }),
    false,
  );
});

test('a new chart question does not silently reuse an unrelated prior table', () => {
  const evidence = {
    sources: [],
    images: [],
    mediaAssetIds: [],
    tabular: {
      datasetId: 'adverse-events',
      columns: ['ae_id', 'count_ae_id'],
      rows: [{ ae_id: 1, count_ae_id: 1 }],
      totalRows: 25,
    },
  };

  assert.equal(
    isDirectTabularPresentationFollowUp(
      'Generate a grouped adverse-event severity chart by arm.',
      evidence,
    ),
    false,
  );
  assert.equal(isDirectTabularPresentationFollowUp('Chart the previous result.', evidence), true);
});

const recurringSubjectEvidence = {
  success: true,
  claimVerification: { status: 'directly-established', directlyEstablished: true },
  evidence: [
    {
      payload:
        'Reconciled visible subject: unidentified Spain player\n' +
        'Identity basis: source-described\n' +
        'Observed appearances: 19.987-19.987s; 50.017-50.017s',
    },
  ],
};

test('a visibility ledger cannot replace the answer to another visual question', () => {
  assert.equal(
    formatObservedAppearanceAnswer(recurringSubjectEvidence, {
      goal: 'compare',
      recordSet: 'all',
    }),
    undefined,
  );
});

test('a visibility trace can render recurring observed moments directly', () => {
  assert.match(
    formatObservedAppearanceAnswer(recurringSubjectEvidence, {
      goal: 'trace',
      recordSet: 'observed',
    }) ?? '',
    /separate observed moments/,
  );
});
