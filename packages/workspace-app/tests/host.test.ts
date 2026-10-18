import assert from 'node:assert/strict';
import test from 'node:test';
import {
  configureWorkspaceHost,
  workspaceUrl,
  workspaceStorageKey,
  workspaceFetch,
} from '../src/host';
import { workspaceAssetResponse } from '../src/asset-server';

test('browser host scopes API calls and storage while preserving external URLs', async () => {
  Object.defineProperty(globalThis, 'window', { value: {}, configurable: true });
  try {
    let project = 'tenant-a/project-a';
    configureWorkspaceHost({
      apiBase: () => '/api/cloud/' + project,
      storageScope: () => project,
      fetch: async (input) => Response.json({ url: String(input) }),
    });
    assert.equal(
      workspaceUrl('/api/documents?groupId=one'),
      '/api/cloud/tenant-a/project-a/documents?groupId=one',
    );
    assert.equal(
      workspaceUrl('/api/cloud/tenant-a/project-a/media/media-one'),
      '/api/cloud/tenant-a/project-a/media/media-one',
    );
    assert.equal(workspaceUrl('https://example.test/api/docs'), 'https://example.test/api/docs');
    const firstKey = workspaceStorageKey('chat_sessions');
    project = 'tenant-b/project-b';
    assert.notEqual(workspaceStorageKey('chat_sessions'), firstKey);
    assert.deepEqual(await (await workspaceFetch(workspaceUrl('/api/groups'))).json(), {
      url: '/api/cloud/tenant-b/project-b/groups',
    });
  } finally {
    Reflect.deleteProperty(globalThis, 'window');
  }
});

test('canonical assets survive bundling and reject unlisted paths', async () => {
  const image = workspaceAssetResponse('icons/firecrawl.png');
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.equal(
    Buffer.from(await image.arrayBuffer())
      .subarray(1, 4)
      .toString(),
    'PNG',
  );
  assert.equal(workspaceAssetResponse('../../package.json').status, 404);
  assert.equal(workspaceAssetResponse('__proto__').status, 404);
});
