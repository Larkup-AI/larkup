import { describe, expect, it } from 'vitest';
import { explicitMediaEvidenceAssetId, leadingMediaAssetId } from './media-retrieval-routing';

describe('leadingMediaAssetId', () => {
  const activeAssets = new Set(['video-1']);
  const documents = new Map([['video-document', 'video-1']]);

  it('does not let a lower-ranked video hijack a PDF question', () => {
    expect(
      leadingMediaAssetId(
        {
          hits: [
            { documentId: 'pdf-document' },
            { documentId: 'video-document', metadata: { mediaAssetId: 'video-1' } },
          ],
        },
        activeAssets,
        documents,
      ),
    ).toBeUndefined();
  });

  it('routes a leading media hit through its active evidence source', () => {
    expect(
      leadingMediaAssetId({ hits: [{ documentId: 'video-document' }] }, activeAssets, documents),
    ).toBe('video-1');
  });

  it('ignores media metadata on an unrouted secondary search hit', () => {
    expect(
      explicitMediaEvidenceAssetId({
        hits: [
          { documentId: 'pdf-document' },
          { documentId: 'video-document', metadata: { mediaAssetId: 'video-1' } },
        ],
      }),
    ).toBeNull();
    expect(explicitMediaEvidenceAssetId({ videoEvidence: { mediaAssetId: 'video-1' } })).toBe(
      'video-1',
    );
  });
});
