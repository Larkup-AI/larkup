import assert from 'node:assert/strict';
import test from 'node:test';
import { filterSupersededTabularDatasets } from '../src/lib/chat/assistant-tabular-scope';

test('a source sidecar link supersedes stale unlinked copies without deleting data', () => {
  const datasets = [
    { id: 'old', fileName: 'assets.csv', groupId: 'g' },
    { id: 'live', fileName: 'assets.csv', groupId: 'g' },
    { id: 'standalone', fileName: 'other.csv', groupId: 'g' },
  ];
  const documents = [{ title: 'assets.csv', groupId: 'g', metadata: { tabularDatasetId: 'live' } }];
  assert.deepEqual(
    filterSupersededTabularDatasets(datasets, documents).map((d) => d.id),
    ['live', 'standalone'],
  );
  assert.equal(datasets.length, 3);
});
test('separate groups and explicitly linked same-name sources remain distinct', () => {
  const datasets = [
    { id: 'a', fileName: 'assets.csv', groupId: 'g' },
    { id: 'b', fileName: 'assets.csv', groupId: 'g' },
    { id: 'c', fileName: 'assets.csv', groupId: 'other' },
  ];
  const documents = ['a', 'b'].map((id) => ({
    title: 'assets.csv',
    groupId: 'g',
    metadata: { tabularDatasetId: id },
  }));
  assert.deepEqual(filterSupersededTabularDatasets(datasets, documents), datasets);
});
