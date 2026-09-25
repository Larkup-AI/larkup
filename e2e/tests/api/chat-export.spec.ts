import { expect, test } from '@playwright/test';

test('exports the exact preceding answer table as a real Excel download', async ({ request }) => {
  const response = await request.post('/api/chat', {
    data: {
      messages: [
        {
          id: 'answer-with-table',
          role: 'assistant',
          parts: [
            {
              type: 'tool-queryTabularData',
              state: 'output-available',
              input: { datasetId: 'participants' },
              output: {
                columns: ['**Name**', '**Organization**'],
                rows: [
                  {
                    '**Name**': 'Ada Lovelace',
                    '**Organization**': 'Analytical Engine',
                  },
                ],
                totalRows: 1,
              },
            },
            { type: 'text', text: 'Ada Lovelace is the participant in this result.' },
          ],
        },
        {
          id: 'export-request',
          role: 'user',
          parts: [{ type: 'text', text: 'In an Excel table, please.' }],
        },
      ],
    },
  });

  const stream = await response.text();
  expect(response.ok(), stream).toBe(true);
  expect(stream).toContain('createDataExport');
  expect(stream).toContain('Larkup-answer.xlsx');
  expect(stream).toContain('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  expect(stream).toMatch(/"fileBase64":"UEsDB/);
  expect(stream).toContain('"rowCount":1');
  expect(stream).toContain('ready to download');
});
