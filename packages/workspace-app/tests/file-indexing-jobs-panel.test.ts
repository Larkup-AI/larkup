import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FileIndexingJobsPanel } from '../src/components/data/file-indexing-jobs-panel';

test('file job panel shows each source stage and measured progress', () => {
  const markup = renderToStaticMarkup(
    createElement(FileIndexingJobsPanel, {
      status: {
        running: true,
        unindexedCount: 3,
        run: null,
        blockers: [],
        sources: [
          {
            id: 'a',
            name: 'protocol.pdf',
            status: 'processing',
            message: 'Creating search embeddings',
            processedChunks: 4,
            totalChunks: 8,
          },
          { id: 'b', name: 'visits.csv', status: 'queued', processedChunks: 0, totalChunks: 0 },
          {
            id: 'c',
            name: 'broken.pdf',
            status: 'failed',
            error: 'BACKGROUND_JOB_INTERRUPTED',
            processedChunks: 0,
            totalChunks: 0,
          },
        ],
      },
    }),
  );
  assert.match(markup, /protocol\.pdf/);
  assert.match(markup, /Creating search embeddings/);
  assert.match(markup, /aria-label="protocol\.pdf indexing progress" aria-valuenow="50"/);
  assert.match(markup, /visits\.csv/);
  assert.match(markup, /Waiting for an indexing worker/);
  assert.match(markup, /broken\.pdf/);
  assert.match(markup, /The indexing worker stopped/);
});
