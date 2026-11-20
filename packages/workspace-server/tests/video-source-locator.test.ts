import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_CONFIG } from '@larkup/core/types';
import { runWithWorkspaceHost } from '@larkup/core/workspace-host';
import { queryKnowledgeBase } from '../src/app/api/chat/tools.ts';

function fixture(options: { mixed?: boolean; enabled?: boolean } = {}) {
  let globalQueries = 0;
  const asset = {
    id: 'recording-a',
    fileName: 'Independent recording',
    type: 'video',
    groupId: 'default',
    processingStatus: 'completed',
    activeVideoKnowledgeRevisionId: 'revision-a',
    videoRuntimeScope: 'cloud',
    documentIds: ['projection-a'],
  };
  const host = {
    project: { id: 'project-a', name: 'Source test' },
    readConfig: async () => ({
      ...DEFAULT_CONFIG,
      toolConfigs: { 'video-intelligence': { runtimeMode: 'managed-cloud' } },
    }),
    readDocuments: async () => [
      {
        id: 'projection-a',
        title: 'Independent recording',
        content: 'A source projection.',
        status: 'indexed',
        groupId: 'default',
        metadata: { mediaAssetId: asset.id },
      },
      ...(options.mixed
        ? [
            {
              id: 'table-a',
              title: 'Measurements.csv',
              content: 'category,value\nA,12',
              status: 'indexed',
              groupId: 'default',
              metadata: {},
            },
          ]
        : []),
    ],
    readGroups: async () => [{ id: 'default', assistantEnabled: options.enabled !== false }],
    readMediaAssets: async () => [asset],
    readTabularDatasets: async () => [],
    readState: async () => undefined,
    queryKnowledge: async () => {
      globalQueries += 1;
      return [];
    },
  } as any;
  return { asset, host, queries: () => globalQueries };
}

test('an explicitly named completed source is located without global semantic ranking', async () => {
  const { host, asset, queries } = fixture();
  const result: any = await runWithWorkspaceHost(host, () =>
    queryKnowledgeBase('In Independent recording, explain the stated service.', 5, null),
  );
  assert.equal(queries(), 0);
  assert.equal(result.videoEvidence.mediaAssetId, asset.id);
  assert.equal(result.hits[0].text, '');
});

test('a mixed table and video request retains global retrieval', async () => {
  const { host, queries } = fixture({ mixed: true });
  await runWithWorkspaceHost(host, () =>
    queryKnowledgeBase('Compare Independent recording with Measurements.csv.', 5, null),
  );
  assert.equal(queries(), 1);
});

test('a hidden source group cannot use the named-source shortcut', async () => {
  const { host } = fixture({ enabled: false });
  const result: any = await runWithWorkspaceHost(host, () =>
    queryKnowledgeBase('Explain Independent recording.', 5, null),
  );
  assert.equal(result.videoEvidence?.mediaAssetId, undefined);
});
