import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterDocumentsAvailableToAssistant,
  filterMediaAssetsAvailableToAssistant,
} from './assistant-data-scope';
import type { DataGroup, MediaAsset, SourceDocument } from './types';

const now = '2026-09-23T00:00:00.000Z';
const groups: DataGroup[] = [
  {
    id: 'default',
    name: 'Default',
    assistantEnabled: true,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'group-1',
    name: 'Group 1',
    assistantEnabled: true,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'group-2',
    name: 'Group 2',
    assistantEnabled: false,
    createdAt: now,
    updatedAt: now,
  },
];

function document(id: string, groupId?: string): SourceDocument {
  return {
    id,
    title: id,
    source: 'text',
    content: id,
    charCount: id.length,
    groupId,
    status: 'indexed',
    createdAt: now,
  };
}

function media(id: string, groupId?: string): MediaAsset {
  return {
    id,
    groupId,
    type: 'video',
    fileName: `${id}.mp4`,
    mimeType: 'video/mp4',
    storageUri: `videos/${id}.mp4`,
    fileSize: 1,
    processingStatus: 'completed',
    documentIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

test('assistant data scope revokes a deleted source immediately', () => {
  const sources = [document('removed-source', 'group-1')];
  assert.deepEqual(
    filterDocumentsAvailableToAssistant(sources, groups).map((source) => source.id),
    ['removed-source'],
  );

  // Deletion removes the source record before asynchronous vector cleanup can
  // complete. No residual vector can pass this source-of-truth boundary.
  assert.deepEqual(filterDocumentsAvailableToAssistant([], groups), []);
});

test('assistant data scope follows a move and current group activation for documents and media', () => {
  const movedDocument = document('moved-document', 'group-2');
  const movedMedia = media('moved-media', 'group-2');

  assert.deepEqual(filterDocumentsAvailableToAssistant([movedDocument], groups), []);
  assert.deepEqual(filterMediaAssetsAvailableToAssistant([movedMedia], groups), []);

  const reactivatedGroups = groups.map((group) =>
    group.id === 'group-2' ? { ...group, assistantEnabled: true } : group,
  );
  assert.deepEqual(
    filterDocumentsAvailableToAssistant([movedDocument], reactivatedGroups).map(
      (source) => source.id,
    ),
    ['moved-document'],
  );
  assert.deepEqual(
    filterMediaAssetsAvailableToAssistant([movedMedia], reactivatedGroups).map((asset) => asset.id),
    ['moved-media'],
  );
});

test('assistant data scope never exposes an orphaned group through stale storage', () => {
  assert.deepEqual(
    filterDocumentsAvailableToAssistant([document('orphan', 'missing')], groups),
    [],
  );
  assert.deepEqual(
    filterMediaAssetsAvailableToAssistant([media('orphan-media', 'missing')], groups),
    [],
  );
});
