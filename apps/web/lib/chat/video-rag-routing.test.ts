import { describe, expect, it } from 'vitest';
import {
  collectExhaustiveVideoEvidencePages,
  indexedVideoEvidenceIsSufficient,
} from './video-rag-routing';

const visual = (startSecs: number, text = 'A source-grounded visual account.') => ({
  modality: 'visual',
  text,
  confidenceScore: 0.8,
  startSecs,
  endSecs: startSecs + 10,
});

describe('video RAG fallback routing', () => {
  it('collects every available exhaustive page without duplicating evidence', async () => {
    const execute = async (input: Record<string, unknown>) => {
      const cursor = Number(input.cursor);
      return {
        success: true,
        mediaAssetId: 'asset-1',
        evidence: [{ id: cursor === 2 ? 'b' : 'c' }, { id: cursor === 2 ? 'c' : 'd' }],
        continuation: {
          exhaustive: true,
          cursor,
          nextCursor: cursor + 2,
          hasMore: cursor < 4,
        },
      };
    };
    const result = (await collectExhaustiveVideoEvidencePages(
      execute,
      { mediaAssetId: 'asset-1', query: 'list everything' },
      {
        success: true,
        mediaAssetId: 'asset-1',
        evidence: [{ id: 'a' }, { id: 'b' }],
        continuation: { exhaustive: true, nextCursor: 2, hasMore: true },
      },
      'call-1',
    )) as any;

    expect(result.evidence.map((item: any) => item.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(result.continuation).toMatchObject({
      exhaustive: true,
      hasMore: false,
      aggregatedItems: 4,
      contextLimitReached: false,
    });
  });

  it('uses a semantically located indexed visual answer without live analysis', () => {
    expect(
      indexedVideoEvidenceIsSufficient({
        verificationStatus: 'supported',
        questionKinds: ['person-attribute'],
        evidence: [visual(30, 'The left participant wears a yellow shirt.')],
        focusSources: ['semantic'],
      }),
    ).toBe(true);
  });

  it('uses a reconciled computed answer without requiring another provider call', () => {
    expect(
      indexedVideoEvidenceIsSufficient({
        verificationStatus: 'supported',
        questionKinds: ['outcome'],
        evidence: [{ ...visual(500, 'Reconciled final state: A leads B.'), modality: 'computed' }],
      }),
    ).toBe(true);
  });

  it('uses a broad indexed timeline for ordered-change questions', () => {
    expect(
      indexedVideoEvidenceIsSufficient({
        verificationStatus: 'supported',
        questionKinds: ['state-change'],
        evidence: [visual(10), visual(310), visual(590)],
        durationSecs: 600,
        hierarchyRanges: 3,
      }),
    ).toBe(true);
  });

  it.each(['conflicted', 'insufficient', 'needs_inspection'] as const)(
    'falls back when verification is %s',
    (verificationStatus) => {
      expect(
        indexedVideoEvidenceIsSufficient({
          verificationStatus,
          questionKinds: ['outcome'],
          evidence: [visual(30, 'Claim verdict: direct\nClaim answer: A')],
          focusSources: ['semantic'],
        }),
      ).toBe(false);
    },
  );

  it('does not promote a weak transcript neighbour into a visual answer', () => {
    expect(
      indexedVideoEvidenceIsSufficient({
        verificationStatus: 'supported',
        questionKinds: ['person-attribute'],
        evidence: [{ ...visual(30, 'People are talking nearby.'), modality: 'transcript' }],
        focusSources: ['lexical'],
      }),
    ).toBe(false);
  });
});
