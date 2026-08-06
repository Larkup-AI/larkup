import { expect, test } from '@playwright/test';
import {
  buildMediaDocumentInputs,
  createFallbackMediaSummary,
  normalizeMediaCitationRange,
  queryAwareExcerpt,
  timestampMediaUrl,
  type MediaEvidenceSegment,
} from '../../../apps/web/lib/media-knowledge';

const segments: MediaEvidenceSegment[] = [
  {
    sequence: 0,
    startSecs: 0,
    endSecs: 60,
    transcript: 'بدأت المباراة',
    visualContext: 'The players enter.',
    text: 'Timeline: 0:00–1:00.\nSpeech: بدأت المباراة\nVisual: The players enter.',
  },
  {
    sequence: 1,
    startSecs: 60,
    endSecs: 120,
    transcript: 'المباراة مستمرة',
    visualContext: 'The score changes.',
    text: 'Timeline: 1:00–2:00.\nSpeech: المباراة مستمرة\nVisual: The score changes.',
  },
  {
    sequence: 2,
    startSecs: 120,
    endSecs: 180,
    transcript: 'فاز فريق نصوحي',
    visualContext: 'Final TOTAL SCORE: فريق نصوحي 20, فريق مرعي 19.',
    text:
      'Timeline: 2:00–3:00.\nSpeech: فاز فريق نصوحي\n' +
      'Visual: Final TOTAL SCORE: فريق نصوحي 20, فريق مرعي 19.',
  },
];

test.describe('Media knowledge documents', () => {
  test('stores an overview plus independently retrievable timestamped evidence', () => {
    const documents = buildMediaDocumentInputs({
      assetId: 'asset-1',
      title: 'ديربي الكون',
      mediaType: 'video',
      localUrl: '/api/media/asset-1',
      originalUrl: 'https://www.youtube.com/watch?v=match',
      durationSecs: 180,
      summary: 'فاز فريق نصوحي بنتيجة 20–19 عند 2:59.',
      segments,
      fileName: 'match.mp4',
      mimeType: 'video/mp4',
      transcriptSource: 'provider-stt',
      transcriptProvider: 'deepgram',
      transcriptLanguage: 'ar',
    });

    // A video now keeps one coarse chapter summary alongside its overview
    // and the three independently retrievable evidence segments.
    expect(documents).toHaveLength(5);
    expect(documents[0].metadata).toMatchObject({
      contentKind: 'video-summary',
      isMediaSummary: true,
      segmentCount: 3,
      transcriptProvider: 'deepgram',
      transcriptLanguage: 'ar',
    });
    expect(documents[0].content).toContain('فاز فريق نصوحي بنتيجة 20–19');

    expect(
      documents.slice(2).map((document) => ({
        sequence: document.metadata?.sequence,
        startSecs: document.metadata?.startSecs,
        endSecs: document.metadata?.endSecs,
      })),
    ).toEqual([
      { sequence: 0, startSecs: 0, endSecs: 60 },
      { sequence: 1, startSecs: 60, endSecs: 120 },
      { sequence: 2, startSecs: 120, endSecs: 180 },
    ]);
    expect(documents.at(-1)?.url).toContain('t=120s');
    expect(documents.at(-1)?.content).toContain('فريق نصوحي 20, فريق مرعي 19');
  });

  test('keeps final evidence in the bounded fallback notes', () => {
    const summary = createFallbackMediaSummary('ديربي الكون', 'video', segments);
    expect(summary).toContain('فاز فريق نصوحي');
    expect(summary).toContain('20, فريق مرعي 19');
  });

  test('creates seekable YouTube and local media URLs', () => {
    expect(timestampMediaUrl('https://youtu.be/match', 125.9)).toContain('t=125s');
    expect(timestampMediaUrl('/api/media/asset-1', 125.9)).toBe('/api/media/asset-1#t=125');
  });

  test('keeps one playable media citation inside the indexed asset duration', () => {
    expect(normalizeMediaCitationRange('video', 180, 120, 240)).toEqual({
      startSecs: 120,
      endSecs: 180,
    });
    expect(normalizeMediaCitationRange('audio', 180, -5, 20)).toEqual({
      startSecs: 0,
      endSecs: 20,
    });
    expect(normalizeMediaCitationRange('image', undefined, 10, 20)).toEqual({});
  });

  test('keeps matched and ending evidence when a document is longer than the response cap', () => {
    const longText = `${'opening context '.repeat(
      300,
    )}فاز فريق نصوحي بنتيجة 20-19${' ceremony'.repeat(300)}`;
    const matched = queryAwareExcerpt(longText, 'من فاز فريق نصوحي', 800);
    expect(matched).toContain('فاز فريق نصوحي بنتيجة 20-19');

    const ending = queryAwareExcerpt(longText, 'unknown wording', 500, true);
    expect(ending).toContain('ceremony');
    expect(ending.length).toBeLessThanOrEqual(501);
  });
});
