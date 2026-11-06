import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('upload progress appears above the staged file list', async () => {
  const source = await readFile(
    new URL('../src/components/data/upload-panel.tsx', import.meta.url),
    'utf8',
  );

  const progressPosition = source.indexOf('{progress && (');
  const stagedFilesPosition = source.indexOf('{staged.length > 0 && (');

  assert.notEqual(progressPosition, -1);
  assert.notEqual(stagedFilesPosition, -1);
  assert.ok(progressPosition < stagedFilesPosition);
});
