import assert from 'node:assert/strict';
import test from 'node:test';
import { trackUsageEvent } from '@larkup/core/analytics-store';
import {
  runWithWorkspaceHost,
  workspaceHost,
  type WorkspaceHost,
} from '@larkup/core/workspace-host';

test('a late stream callback restores its captured host before recording usage', async () => {
  const tracked: Array<{ totalTokens?: number }> = [];
  const now = new Date().toISOString();
  const host: WorkspaceHost = {
    project: { id: crypto.randomUUID(), name: 'Test', port: 0, createdAt: now, updatedAt: now },
    readConfig: async () => ({}) as never,
    writeConfig: async (config) => config,
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
    trackUsage: async (event) => {
      tracked.push(event);
      return { ...event, id: crypto.randomUUID() };
    },
  };

  const lateCallback = await runWithWorkspaceHost(host, () => {
    const capturedHost = workspaceHost();
    return async () => {
      await runWithWorkspaceHost(capturedHost!, () =>
        trackUsageEvent({ type: 'chat', totalTokens: 17, timestamp: now }),
      );
    };
  });

  await lateCallback();
  assert.deepEqual(tracked, [{ type: 'chat', totalTokens: 17, timestamp: now }]);
});
