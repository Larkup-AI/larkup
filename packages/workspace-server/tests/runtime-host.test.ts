import assert from 'node:assert/strict';
import test from 'node:test';
import {
  runWithWorkspaceRuntime,
  workspaceServerUrl,
  workspaceServerFetch,
  workspaceSandbox,
} from '../src/runtime-host';

test('concurrent server tool calls retain their own host and sandbox', async () => {
  const outputs = await Promise.all(
    ['one', 'two'].map((id) =>
      runWithWorkspaceRuntime(
        {
          apiUrl: (path) => '/workspace/' + id + path,
          fetch: async () => Response.json({ project: id }),
          sandbox: {
            healthCheck: async () => ({ status: 'ready', backend: 'vercel' }),
            execute: async () => ({ stdout: id, stderr: '', exitCode: 0, executionTimeMs: 1 }),
          },
        },
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 1));
          assert.equal(workspaceServerUrl('/api/media'), '/workspace/' + id + '/api/media');
          assert.deepEqual(await (await workspaceServerFetch('/api/media')).json(), {
            project: id,
          });
          return (
            await workspaceSandbox({ backend: 'vercel' }).execute({
              language: 'python',
              code: 'print(1)',
            })
          ).stdout;
        },
      ),
    ),
  );
  assert.deepEqual(outputs, ['one', 'two']);
  assert.equal(workspaceServerUrl('/api/media'), '/api/media');
});
