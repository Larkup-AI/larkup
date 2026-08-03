import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('POST /api/parse-file extracts text from a PDF', async ({ request }) => {
  const buffer = await readFile(path.join(repoRoot, 'e2e/demo-data/demo.pdf'));
  const response = await request.post('/api/parse-file', {
    multipart: {
      file: {
        name: 'demo.pdf',
        mimeType: 'application/pdf',
        buffer,
      },
    },
  });

  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.text).toContain('ABDELRAHMAN ABOUNIDA');
});
