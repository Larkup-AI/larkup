import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasNumberedDocumentReference,
  findRetrievedPdfSource,
  inspectedPdfNeedsVisualReading,
  preferredPdfPagesForInspection,
} from '../src/lib/chat/visual-routing.ts';

test('treats single-level figure and table references as page-ranking intent', () => {
  assert.equal(hasNumberedDocumentReference('Read Figure 2 and summarize the forest plot.'), true);
  assert.equal(hasNumberedDocumentReference('Use Table 1 to calculate the rates.'), true);
  assert.equal(preferredPdfPagesForInspection(1, 'Use Table 1 to calculate the rates.'), undefined);
});

test('prefers the PDF named in a mixed-source question over a different visual hit', () => {
  const result = findRetrievedPdfSource(
    {
      hits: [
        { documentId: 'chart', title: 'Trial_CSR.pdf', metadata: { pageNumber: 2 } },
        { documentId: 'report', title: 'Site_Monitoring_Report.pdf' },
      ],
    },
    'Which site in the monitoring report exceeded its threshold?',
  );
  assert.equal(result?.documentId, 'report');
});

test('reads a referenced chart for numeric facts even when the question names only the report', () => {
  assert.equal(
    inspectedPdfNeedsVisualReading('Which site exceeded the threshold, and how many deviations?', {
      pages: [
        { text: 'Figure 2 shows cumulative deviations by site. Red sites exceed the threshold.' },
      ],
    }),
    true,
  );
  assert.equal(
    inspectedPdfNeedsVisualReading('Summarize the recommendations.', {
      pages: [{ text: 'Figure 2 shows cumulative deviations by site.' }],
    }),
    false,
  );
});
