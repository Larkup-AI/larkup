import { expect, test } from '@playwright/test';
import { PERSONALIZED_RESPONSE_STYLE } from '../../../apps/web/lib/chat/response-style';

test('keeps grounded answers free of retrieval and storage language', () => {
  expect(PERSONALIZED_RESPONSE_STYLE).toContain('personalized assistant');
  expect(PERSONALIZED_RESPONSE_STYLE).toContain('Never mention or imply documents');
  expect(PERSONALIZED_RESPONSE_STYLE).toContain('Based on');
  expect(PERSONALIZED_RESPONSE_STYLE).toContain('The search results show');
});
