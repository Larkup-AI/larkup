import assert from 'node:assert/strict';
import test from 'node:test';
import { selectRelevantPdfPages, pdfPageVisionImages } from '../src/lib/media/pdf-inspection.ts';
import { createCanvas } from '@napi-rs/canvas';

test('multi-figure PDF pages give vision overlapping close-ups with the correct PNG type', async () => {
  const canvas = createCanvas(100, 200);
  const rendered = canvas.toBuffer('image/png');
  assert.equal(
    (await pdfPageVisionImages(rendered, 'Figure 1 shows volume. Figure 2 shows cost.')).length,
    3,
  );
  assert.equal((await pdfPageVisionImages(rendered, 'Figure 1 shows volume.')).length, 3);
  assert.equal((await pdfPageVisionImages(rendered, 'A plain text page.')).length, 1);
  assert.match(
    (await pdfPageVisionImages(rendered, 'Figure 1. Figure 2.'))[1],
    /^data:image\/png;base64,/u,
  );
});

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
