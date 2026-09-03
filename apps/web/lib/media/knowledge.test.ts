import { describe, expect, it } from 'vitest';
import { buildMediaDocumentInputs } from './knowledge';

describe('buildMediaDocumentInputs', () => {
  it('clamps timestamp evidence and chapters to the source duration', () => {
    const documents = buildMediaDocumentInputs({
      assetId: 'asset-1',
      title: 'Demo',
      mediaType: 'video',
      localUrl: '/api/media/asset-1',
      durationSecs: 60,
      summary: 'Summary',
      segments: [
        {
          text: 'Opening evidence',
          startSecs: -30,
          endSecs: 90,
          sequence: 0,
        },
      ],
      fileName: 'demo.mp4',
      mimeType: 'video/mp4',
      transcriptSource: 'test',
    });

    const chapter = documents.find(
      (document) => document.metadata?.contentKind === 'media-chapter',
    );
    const segment = documents.find(
      (document) => document.metadata?.contentKind === 'multimodal-segment',
    );
    expect(chapter?.metadata).toMatchObject({ chapterIndex: 0, startSecs: 0, endSecs: 60 });
    expect(segment?.metadata).toMatchObject({ startSecs: 0, endSecs: 60 });
    expect(segment?.url).toBe('/api/media/asset-1#t=0');
  });
});
