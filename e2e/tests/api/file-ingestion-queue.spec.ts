import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const repoRoot = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');

test('file uploads stay available and queue another indexing pass', async () => {
  const uploadPanel = await readFile(
    `${repoRoot}/apps/web/components/data/upload-panel.tsx`,
    'utf8',
  );
  const dataWorkspace = await readFile(
    `${repoRoot}/apps/web/components/data/data-workspace.tsx`,
    'utf8',
  );
  const indexRoute = await readFile(`${repoRoot}/apps/web/app/api/index/route.ts`, 'utf8');

  expect(uploadPanel).toContain("? 'Add more files'");
  expect(uploadPanel).toContain('onClick: saving ?');
  expect(uploadPanel).toContain('joinedActiveSave');
  expect(uploadPanel).toContain('filesToIngest');
  expect(dataWorkspace).toContain('new files will join the queue');
  expect(dataWorkspace).not.toContain('setIndexDialogOpen(true)');
  expect(indexRoute).toContain('scheduleQueuedIndex()');
  expect(indexRoute).toContain('queued: true');
});
