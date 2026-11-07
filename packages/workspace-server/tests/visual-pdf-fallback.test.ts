import assert from 'node:assert/strict';
import test from 'node:test';
import {
  retainPreferredPdfHit,
  selectVisualPdfFallbackDocuments,
} from '../src/lib/chat/retrieval-ranking.ts';

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

test('retains one relevant PDF when ranked table chunks fill a mixed visual answer', () => {
  const rows = ['row-1', 'row-2', 'row-3', 'row-4'].map((documentId) => ({ documentId }));
  const pdf = { documentId: 'report' };
  assert.deepEqual(
    retainPreferredPdfHit(rows, [...rows, pdf], ['report'], 4).map((hit) => hit.documentId),
    ['row-1', 'row-2', 'row-3', 'report'],
  );
  assert.deepEqual(retainPreferredPdfHit(rows, [...rows, pdf], [], 4), rows);
  assert.equal(
    retainPreferredPdfHit(rows, [...rows, { documentId: 'other' }, pdf], ['report', 'other'], 4)[3]
      ?.documentId,
    'report',
  );
});

test('ranks rare visual-topic terms above generic figure and arm mentions', () => {
  const documents = [
    {
      id: 'generic',
      title: 'clinical_report.pdf',
      content: 'Figure 1 shows results for each treatment arm.',
      status: 'indexed',
      metadata: { fileKind: 'pdf' },
    },
    {
      id: 'design',
      title: 'study_protocol.pdf',
      content: 'Figure 1 shows the study design, randomization, and stratification factors.',
      status: 'indexed',
      metadata: { fileKind: 'pdf' },
    },
  ];
  assert.equal(
    selectVisualPdfFallbackDocuments(
      'Per the design figure, what are the stratification factors for each arm?',
      documents,
      1,
    )[0]?.id,
    'design',
  );
});
