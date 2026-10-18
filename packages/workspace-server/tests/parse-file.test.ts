import assert from 'node:assert/strict';
import test from 'node:test';
import { hasReadablePdfText } from '../src/app/api/parse-file/route.ts';

test('page counters do not make an image-only PDF look readable', () => {
  assert.equal(hasReadablePdfText('\n\n-- 1 of 2 --\n\n\n\n-- 2 of 2 --\n\n'), false);
});

test('real PDF text remains readable alongside page counters', () => {
  assert.equal(hasReadablePdfText('-- 1 of 2 --\nQuarterly revenue\n-- 2 of 2 --'), true);
});
