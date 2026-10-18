import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMediaDocumentInputs,
  createFallbackMediaSummary,
} from '../src/lib/media/knowledge.ts';

test('keeps source-language media notes free of English wrapper text', () => {
  const documents = buildMediaDocumentInputs({
    assetId: 'asset-1',
    title: 'مقطع',
    mediaType: 'video',
    localUrl: '/api/media/asset-1',
    durationSecs: 60,
    summary: 'فتاة تغني على المسرح.',
    segments: [
      {
        text: 'الفتاة ترتدي فستانًا مزهرًا وتغني.',
        startSecs: 0,
        endSecs: 30,
        sequence: 0,
      },
    ],
    fileName: 'clip.mp4',
    mimeType: 'video/mp4',
    transcriptSource: 'test',
    transcriptLanguage: 'ar',
  });

  assert.equal(documents[0]?.content, 'فتاة تغني على المسرح.');
  assert.equal(
    documents.find((document) => document.metadata?.contentKind === 'multimodal-segment')?.content,
    'الفتاة ترتدي فستانًا مزهرًا وتغني.',
  );
  assert.ok(
    documents.every((document) => !/Video:|Duration:|Evidence at|Chapter/.test(document.content)),
  );
});

test('uses timestamped evidence itself as the language-neutral fallback', () => {
  const summary = createFallbackMediaSummary('مقطع', 'video', [
    { text: 'كلمات الأغنية', startSecs: 0, endSecs: 10, sequence: 0 },
  ]);
  assert.equal(summary, '[0:00–0:10]\nكلمات الأغنية');
});
