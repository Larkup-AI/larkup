import { describe, expect, it } from 'vitest';
import { formatCacheBytes } from './cache-size';

describe('cache size formatting', () => {
  it('uses compact kilobytes for small non-empty caches', () => {
    expect(formatCacheBytes(447)).toBe('0.4 KB');
    expect(formatCacheBytes(46)).toBe('< 0.1 KB');
  });

  it('keeps empty and larger cache sizes clear', () => {
    expect(formatCacheBytes(0)).toBe('0 B');
    expect(formatCacheBytes(1024)).toBe('1.0 KB');
    expect(formatCacheBytes(5 * 1024 ** 3)).toBe('5.0 GB');
  });
});
