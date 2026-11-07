import assert from 'node:assert/strict';
import test from 'node:test';
import { saveStructuredFilesAsTabularDatasets } from '../src/components/data/tabular-upload';

test('saves structured files for analysis before document indexing', async () => {
  const requests: Array<{ url: string; body: unknown }> = [];
  const saved = await saveStructuredFilesAsTabularDatasets(
    [
      {
        id: 'table',
        name: 'visits.csv',
        format: 'structured',
        rows: [{ visit: 'Week 12' }],
        indexAsTabular: true,
      },
      { id: 'note', name: 'note.txt', format: 'plain' },
    ],
    'default',
    (async (url, init) => {
      requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response(
        JSON.stringify({
          id: 'dataset-1',
          fileName: 'visits.csv',
          rowCount: 1,
          columns: [{ name: 'visit' }],
        }),
        { status: 200 },
      );
    }) as typeof fetch,
  );
  assert.deepEqual(requests, [
    {
      url: '/api/tabular',
      body: {
        fileName: 'visits.csv',
        rows: [{ visit: 'Week 12' }],
        groupId: 'default',
      },
    },
  ]);
  assert.deepEqual(saved, [
    {
      sourceFileId: 'table',
      id: 'dataset-1',
      fileName: 'visits.csv',
      rowCount: 1,
      columnCount: 1,
    },
  ]);
});

test('fails rather than silently indexing a structured upload as text only', async () => {
  await assert.rejects(
    saveStructuredFilesAsTabularDatasets(
      [
        {
          id: 'table',
          name: 'visits.csv',
          format: 'structured',
          rows: [{ visit: 'Week 12' }],
          indexAsTabular: true,
        },
      ],
      'default',
      (async () =>
        new Response(JSON.stringify({ error: 'Storage unavailable' }), {
          status: 503,
        })) as typeof fetch,
    ),
    /Could not save visits\.csv as an analytical dataset: Storage unavailable/,
  );
});
