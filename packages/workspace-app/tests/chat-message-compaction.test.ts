import assert from 'node:assert/strict';
import test from 'node:test';
import { compactToolResult } from '../src/lib/chat/message-compaction.ts';

test('PDF inspection compaction preserves selected pages without heavy evidence', () => {
  const compact = compactToolResult({
    success: true,
    pages: [
      {
        pageNumber: 2,
        previewUrl: '/api/pdf-page?documentId=pdf-1&pageNumber=2',
        text: 'large page text',
        tables: [{ rows: [['large table']] }],
      },
    ],
  });

  assert.deepEqual(compact, {
    success: true,
    pages: [{ pageNumber: 2, previewUrl: '/api/pdf-page?documentId=pdf-1&pageNumber=2' }],
  });
});
