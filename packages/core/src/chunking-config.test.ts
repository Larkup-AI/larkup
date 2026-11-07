import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateChunkingParams } from './types';

test('chunk settings reject invalid ranges and overlap', () => {
  assert.equal(
    validateChunkingParams({ chunkSize: 512, chunkOverlap: 64, strategy: 'recursive' }),
    null,
  );
  assert.match(
    validateChunkingParams({ chunkSize: 128, chunkOverlap: 128, strategy: 'fixed' })!,
    /smaller/,
  );
  assert.match(
    validateChunkingParams({ chunkSize: 63, chunkOverlap: 0, strategy: 'sentence' })!,
    /64/,
  );
  assert.match(
    validateChunkingParams({ chunkSize: 512, chunkOverlap: -1, strategy: 'recursive' })!,
    /overlap/,
  );
  assert.match(
    validateChunkingParams({ chunkSize: 512, chunkOverlap: 0, strategy: 'unknown' })!,
    /strategy/,
  );
});
