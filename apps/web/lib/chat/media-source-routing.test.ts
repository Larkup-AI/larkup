import { describe, expect, it } from 'vitest';
import {
  activeMediaFollowUpResult,
  clearlyTitleMatchedMediaAsset,
  shouldKeepActiveMediaSource,
  type RoutableMediaAsset,
} from './media-source-routing';

const asset = (id: string, fileName: string): RoutableMediaAsset => ({
  id,
  fileName,
  processingStatus: 'completed',
  activeVideoKnowledgeRevisionId: `revision-${id}`,
  type: 'video',
  documentIds: [`document-${id}`],
});

describe('media source routing', () => {
  it('keeps a follow-up on the active source without exposing unrelated global hits', () => {
    expect(
      activeMediaFollowUpResult(
        'score of each phase',
        asset('active', 'Active video'),
        'A chronological indexed account.',
      ),
    ).toEqual({
      query: 'score of each phase',
      hits: [
        {
          title: 'Active video',
          url: '/api/media/active',
          score: 1,
          text: 'A chronological indexed account.',
          context: 'A chronological indexed account.',
          metadata: {
            mediaAssetId: 'active',
            mediaType: 'video',
            fileName: 'Active video',
          },
        },
      ],
      videoEvidence: {
        mediaAssetId: 'active',
        fileName: 'Active video',
        retrievalFallback: 'active-conversation-media-source',
      },
    });
  });

  it('selects an explicitly named source when its title has a clear lead', () => {
    const selected = clearlyTitleMatchedMediaAsset(
      'who won Mohamed Hazem and Omar Khaled in Seventy Q&A',
      [
        asset('other', 'Mohamed Tarek and Mostafa Sedky in Seventy Q&A'),
        asset('target', 'Mohamed Hazem and Omar Khaled in Seventy Q&A'),
      ],
    );
    expect(selected?.id).toBe('target');
  });

  it('does not guess when two titles tie', () => {
    expect(
      clearlyTitleMatchedMediaAsset('the weekly episode', [
        asset('a', 'The weekly episode A'),
        asset('b', 'The weekly episode B'),
      ]),
    ).toBeUndefined();
  });

  it('identifies another explicit video instead of treating it as the active follow-up', () => {
    expect(
      clearlyTitleMatchedMediaAsset('what happened in the Spain semifinal', [
        asset('final', 'Spain vs Argentina final highlights'),
        asset('semi', 'France vs Spain semifinal highlights'),
      ])?.id,
    ).toBe('semi');
  });

  it('re-runs retrieval for another video or an ambiguous multi-video question', () => {
    const final = asset('final', 'Spain vs Argentina final highlights');
    const semifinal = asset('semi', 'France vs Spain semifinal highlights');

    expect(
      shouldKeepActiveMediaSource('what happened in the Spain semifinal', final, [
        final,
        semifinal,
      ]),
    ).toBe(false);
    expect(shouldKeepActiveMediaSource('who won?', final, [final, semifinal])).toBe(false);
    expect(
      shouldKeepActiveMediaSource('what happened in the Argentina final', final, [
        final,
        semifinal,
      ]),
    ).toBe(true);
  });
});
