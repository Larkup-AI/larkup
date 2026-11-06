import assert from 'node:assert/strict';
import test from 'node:test';
import { selectRelevantPdfPages } from '../src/lib/media/pdf-inspection.ts';

test('covers distinct endpoint and schedule clauses in a compound PDF question', () => {
  const pages = [
    {
      num: 1,
      text: 'Table 1 visit schedule. Visit 1 is in person. Visits 2 through 6 are telephone. Visit 7 is in person.',
    },
    {
      num: 2,
      text: 'Telephone visit follow-up schedule and visit procedures are listed here again.',
    },
    {
      num: 3,
      text: 'Intervention objectives and endpoints: reduce asthma exacerbations and improve symptom control and quality of life.',
    },
    { num: 4, text: 'General protocol administration and evidence retention.' },
  ];
  const selected = selectRelevantPdfPages(
    pages,
    'Extract the main intervention objectives and endpoints and explain Table 1 visit schedule, including in person and telephone visits.',
    2,
  );
  assert.deepEqual(new Set(selected), new Set([1, 3]));
});
