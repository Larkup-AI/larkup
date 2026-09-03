import { describe, expect, it } from 'vitest';
import { canonicalMediaSourceUrl, newestEquivalentMediaAsset } from './source-identity';

describe('canonicalMediaSourceUrl', () => {
  it('treats seek and tracking variants as the same media source', () => {
    expect(canonicalMediaSourceUrl('https://media.example/watch?v=abc&t=6s&utm_source=chat')).toBe(
      canonicalMediaSourceUrl('https://media.example/watch?v=abc'),
    );
  });

  it('keeps parameters that identify different source media', () => {
    expect(canonicalMediaSourceUrl('https://media.example/watch?v=abc')).not.toBe(
      canonicalMediaSourceUrl('https://media.example/watch?v=def'),
    );
  });
});

describe('newestEquivalentMediaAsset', () => {
  it('prefers the newest completed import across seek URL variants', () => {
    const old = {
      id: 'old',
      originalUrl: 'https://www.youtube.com/watch?v=abc',
      updatedAt: '2026-09-02T00:00:00Z',
    };
    const current = {
      id: 'current',
      originalUrl: 'https://www.youtube.com/watch?v=abc&t=6s',
      updatedAt: '2026-09-03T00:00:00Z',
    };

    expect(newestEquivalentMediaAsset(old, [old, current])).toBe(current);
  });
});
