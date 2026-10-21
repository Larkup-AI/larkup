import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { compactToolResult } from '../src/lib/chat/message-compaction.ts';
import { ChatMediaPreview } from '../src/components/chat/tools/chat-media-preview.tsx';

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

test('remote videos use the materialized asset instead of a provider iframe', () => {
  const html = renderToStaticMarkup(
    createElement(ChatMediaPreview, {
      assetId: 'video-1',
      mediaType: 'video',
      mediaUrl: '/api/media/video-1',
      sourceUrl: 'https://www.youtube.com/watch?v=blocked-by-rightsholder',
      startSecs: 100,
      endSecs: 120,
    }),
  );

  assert.match(html, /<video/);
  assert.match(html, /\/api\/media\/video-1#t=100,120/);
  assert.doesNotMatch(html, /<iframe/);
  assert.match(html, /Open source/);
});
