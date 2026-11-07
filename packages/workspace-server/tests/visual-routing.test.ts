import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasNumberedDocumentReference,
  findRetrievedPdfSource,
  inspectedPdfNeedsVisualReading,
  pdfPagesForVisualAnalysis,
  prioritizeFreshPdfVisualEvidence,
  visualEntityMismatch,
  visualEntityEvidenceLine,
  pdfPlotTabularCountDifference,
  visualRateMismatch,
  preferredPdfPagesForInspection,
} from '../src/lib/chat/visual-routing.ts';

test('treats single-level figure and table references as page-ranking intent', () => {
  assert.equal(hasNumberedDocumentReference('Read Figure 2 and summarize the forest plot.'), true);
  assert.equal(hasNumberedDocumentReference('Use Table 1 to calculate the rates.'), true);
  assert.equal(preferredPdfPagesForInspection(1, 'Use Table 1 to calculate the rates.'), undefined);
});

test('computes a plot-versus-table population gap only for a count query', () => {
  const question = 'In Figure 2, why does the count differ from the plot n?';
  const pdf = { pages: [{ analysis: 'The plot counts Week 12 completers (n=139).' }] };
  assert.deepEqual(
    pdfPlotTabularCountDifference(
      question,
      pdf,
      { totalRows: 158 },
      { aggregations: [{ op: 'count' }] },
    ),
    { plotN: 139, tableCount: 158, difference: 19, plotPopulation: 'completers' },
  );
  assert.equal(
    pdfPlotTabularCountDifference(question, pdf, { totalRows: 158 }, { filters: [] }),
    undefined,
  );
});

test('selects the subgroup n matching the table filter instead of the overall plot n', () => {
  const question =
    'In Figure 2, how many subjects aged >=65 are in the CSV and why does it differ from plot n?';
  const pdf = {
    pages: [{ analysis: '- Overall (n=532)\n- Age < 65 (n=393)\n- Age ≥ 65 (n=139)' }],
  };
  assert.deepEqual(
    pdfPlotTabularCountDifference(
      question,
      pdf,
      { totalRows: 158 },
      { aggregations: [{ op: 'count' }], filters: [{ column: 'age', op: 'gte', value: 65 }] },
    ),
    { plotN: 139, tableCount: 158, difference: 19 },
  );
});

test('carries the PDF entity and numerator into a successful mixed calculation', () => {
  assert.equal(
    visualEntityEvidenceLine('Which site has the most deviations per randomized subject?', {
      pages: [{ analysis: 'Site S07 has 39 deviations.' }],
    }),
    'Verified PDF visual: S07; 39 deviations.',
  );
});

test('rejects a raw PDF count mislabeled as a per-person rate', () => {
  const question = 'Give deviations per randomized subject.';
  const pdf = { pages: [{ analysis: 'Site S07 has 39 deviations.' }] };
  assert.match(
    visualRateMismatch(question, pdf, 'enrollment: 32\ndeviations_per_randomized_subject: 39') ??
      '',
    /39 \/ 32 = 1\.2188/u,
  );
  assert.equal(
    visualRateMismatch(question, pdf, 'enrollment: 32\ndeviations_per_randomized_subject: 1.22'),
    undefined,
  );
  assert.equal(
    visualRateMismatch(
      question,
      { pages: [{ analysis: 'S01: 13 deviations. S07: 39 deviations.' }] },
      'enrollment: 32\ndeviations_per_randomized_subject: 1.22',
    ),
    undefined,
  );
});

test('checks a visual rate against the count for the returned entity', () => {
  const question = 'Which site exceeds the threshold? Give deviations per randomized subject.';
  const pdf = {
    pages: [{ analysis: 'S01: 13 deviations. S07: 39 deviations.' }],
  };
  assert.equal(
    visualRateMismatch(
      question,
      pdf,
      'site_id: S07\nenrollment: 32\ndeviations_per_randomized_subject: 1.21875',
    ),
    undefined,
  );
  assert.match(
    visualRateMismatch(
      question,
      pdf,
      'site_id: S07\nenrollment: 32\ndeviations_per_randomized_subject: 39',
    ) ?? '',
    /39 \/ 32 = 1\.2188/u,
  );
  assert.equal(
    visualRateMismatch(
      question,
      { pages: [{ analysis: 'S01: 13 deviations. The threshold is exceeded at S07.' }] },
      'site_id: S07\nenrollment: 32\ndeviations_per_randomized_subject: 1.21875',
    ),
    undefined,
  );
});

test('fresh visual evidence replaces stale OCR snippets for mixed PDF and table reasoning', () => {
  const evidence = prioritizeFreshPdfVisualEvidence(
    {
      hits: [{ documentId: 'pdf', title: 'Report.pdf', text: 'Old OCR says S06.' }],
      pdfInspection: { pages: [{ pageNumber: 1 }, { pageNumber: 2 }] },
      pdfVisualAnalysis: { success: true, pages: [{ pageNumber: 1, analysis: 'Site S07' }] },
    },
    [1],
  ) as any;
  assert.equal(evidence.hits[0].text, undefined);
  assert.deepEqual(
    evidence.pdfInspection.pages.map((page: any) => page.pageNumber),
    [1],
  );
  assert.equal(evidence.pdfVisualAnalysis.pages[0].analysis, 'Site S07');
});

test('rejects a computed entity that contradicts a single explicit PDF visual label', () => {
  const question = 'Which site exceeds the threshold in the report?';
  const pdf = {
    pages: [{ analysis: 'The site exceeding the threshold is **Site S07**, with 39 deviations.' }],
  };
  assert.match(
    visualEntityMismatch(question, pdf, 'site_id: S06\ncity: Madrid') ?? '',
    /PDF visual identifies S07/u,
  );
  assert.equal(visualEntityMismatch(question, pdf, 'site_id: S07\ncity: Seville'), undefined);
  assert.equal(visualEntityMismatch('Summarize every site.', pdf, 'S06 S07'), undefined);
});

test('analyzes only the best page for one visual claim but keeps cross-page comparisons', () => {
  assert.deepEqual(
    pdfPagesForVisualAnalysis('Which site in the report exceeds the threshold?', [1, 2]),
    [1],
  );
  assert.deepEqual(
    pdfPagesForVisualAnalysis('Compare Figure 1 and Figure 2.', [2, 1, 3]),
    [2, 1, 3],
  );
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
