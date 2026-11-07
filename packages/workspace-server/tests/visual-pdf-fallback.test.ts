import assert from 'node:assert/strict';
import test from 'node:test';
import { selectVisualPdfFallbackDocuments } from '../src/lib/chat/retrieval-ranking.ts';

test('recovers a chart PDF from indexed page descriptions when row-level data dominates retrieval', () => {
  const documents = [
    {
      id: 'visits',
      title: 'visits.csv',
      content: 'subject_id, visit_week, sbp',
      status: 'indexed',
      metadata: {},
    },
    {
      id: 'csr',
      title: 'study_csr.pdf',
      content:
        'Figure 1 shows mean SBP over 12 weeks by treatment arm. Values at Week 12 are annotated.',
      status: 'indexed',
      metadata: {
        fileKind: 'pdf',
        images: [
          {
            description:
              'Line chart of mean systolic BP over time by treatment arm with Week 12 values.',
          },
        ],
      },
    },
  ];

  assert.deepEqual(
    selectVisualPdfFallbackDocuments(
      "In the CSR's line chart of mean SBP over time, what are the Week 12 values per arm?",
      documents,
    ).map((document) => document.id),
    ['csr'],
  );
});

test('recovers a text-indexed PDF without images so its original page can be inspected', () => {
  const documents = [
    {
      id: 'legacy-report',
      title: 'clinical_report.pdf',
      content:
        'The Kaplan-Meier progression-free survival curve and number at risk are shown in Figure 2.',
      status: 'indexed',
      metadata: { fileKind: 'pdf' },
    },
  ];
  assert.deepEqual(
    selectVisualPdfFallbackDocuments(
      'What does the Kaplan-Meier curve show for patients at risk?',
      documents,
    ).map((document) => document.id),
    ['legacy-report'],
  );
});
