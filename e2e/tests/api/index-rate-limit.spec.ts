import { expect, test } from '@playwright/test';
import { isRateLimitError, rateLimitDelayMs } from '../../../packages/core/src/indexing/indexer';

test('recognizes Gemini quota errors and honors their retry window', () => {
  const error = new Error(
    'Quota exceeded for metric embed_content_free_tier_requests. Please retry in 30.208688029s.',
  );

  expect(isRateLimitError(error)).toBe(true);
  expect(rateLimitDelayMs(error, 1)).toBe(30_209);
});

test('backs off rate-limited providers that do not provide a retry window', () => {
  expect(isRateLimitError({ statusCode: 429, message: 'request failed' })).toBe(true);
  expect(rateLimitDelayMs(new Error('Too many requests'), 3)).toBe(20_000);
  expect(isRateLimitError(new Error('invalid API key'))).toBe(false);
});
