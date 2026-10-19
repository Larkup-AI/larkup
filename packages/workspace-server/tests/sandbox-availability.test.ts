import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_CONFIG } from '@larkup/core/types';
import { runWithWorkspaceHost, type WorkspaceHost } from '@larkup/core/workspace-host';
import { getChatTools } from '../src/app/api/chat/tools.ts';
import { runWithWorkspaceRuntime } from '../src/runtime-host.ts';

test('sandbox availability is cached within a host, never across tenant hosts', async () => {
  const config = { ...DEFAULT_CONFIG, defaultSandboxProvider: 'vercel' as const };
  for (const ready of [false, true, false]) {
    let checks = 0;
    const now = new Date().toISOString();
    const host: WorkspaceHost = {
      project: { id: crypto.randomUUID(), name: 'Test', port: 0, createdAt: now, updatedAt: now },
      readConfig: async () => config,
      writeConfig: async (value) => value,
      readState: async () => undefined,
      writeState: async () => {},
      readDocuments: async () => [],
      writeDocuments: async () => {},
      readGroups: async () => [],
      writeGroups: async () => {},
      readMediaAssets: async () => [],
      writeMediaAssets: async () => {},
      readTabularDatasets: async () => [],
      writeTabularDatasets: async () => {},
      queryKnowledge: async () => [],
      trackUsage: async (event) => ({ ...event, id: crypto.randomUUID() }),
      tools: [],
    };
    await runWithWorkspaceHost(host, () =>
      runWithWorkspaceRuntime(
        {
          sandbox: {
            healthCheck: async () => {
              checks += 1;
              return { backend: 'vercel', status: ready ? 'ready' : 'missing-credentials' };
            },
            execute: async () => {
              throw new Error('Inventory must not execute analysis.');
            },
          },
        },
        async () => {
          for (let call = 0; call < 2; call += 1) {
            const { tools } = await getChatTools({ projectId: host.project.id, config });
            assert.equal(Boolean(tools.executeAnalysis), ready);
            assert.ok(tools.queryTabularData);
          }
          assert.equal(checks, 1);
        },
      ),
    );
  }
});
