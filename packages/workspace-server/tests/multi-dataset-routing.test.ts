import assert from 'node:assert/strict';
import test from 'node:test';
import type { TabularDatasetMeta } from '@larkup/core/tabular-store';
import {
  analysisCodeValidationError,
  analysisValidationRequirements,
  appendExplicitValidationZeroCounts,
  normalizePercentagePrecisionInStdout,
  isLikelyTabularQuestion,
  hasExhaustedAnalysisAttempts,
  requiresPdfAndTabularEvidence,
  requiresMultiDatasetAnalysis,
  requiresTabularSandbox,
  repairUnavailableTabularDatasetReferences,
  resolveTabularDatasetReferences,
  shouldUseRecentAnalysisTable,
  shouldPrioritizeTabularAnalysisBeforePdf,
  splitTabularDatasetReferences,
  tabularDatasetIdsReferencedByCode,
  tabularDatasetIdsForAnalysis,
  tabularDatasetIdsRequiredByQuestion,
  tabularRelationships,
} from '../src/lib/chat/tabular-routing.ts';
import { remapMountedDatasetReads } from '../src/lib/chat/tabular-sandbox-files.ts';

const dataset = (id: string, fileName: string, columns: string[]): TabularDatasetMeta => ({
  id,
  fileName,
  columns: columns.map((name) => ({ name, type: 'string', nullCount: 0, uniqueCount: 1 })),
  rowCount: 10,
  summary: {
    totalRows: 10,
    totalColumns: columns.length,
    numericColumns: 0,
    categoricalColumns: columns.length,
    dateColumns: 0,
  },
  createdAt: '2026-11-06T00:00:00.000Z',
});

const datasets = [
  dataset('trials', 'trials.csv', ['trial_id', 'status', 'target_enrollment']),
  dataset('patients', 'patients.csv', ['patient_id', 'arm', 'age', 'sex']),
  dataset('events', 'adverse_events.csv', ['ae_id', 'patient_id', 'ctc_grade', 'serious']),
  dataset('visits', 'treatment_visits.csv', ['visit_id', 'patient_id', 'site_id', 'status']),
  dataset('labs', 'lab_biomarkers.csv', ['result_id', 'visit_id', 'analyte', 'out_of_range']),
  dataset('sites', 'sites.csv', ['site_id', 'site_name']),
];

test('routes a cross-file safety question to multi-dataset analysis without requiring join jargon', () => {
  assert.equal(
    requiresMultiDatasetAnalysis(
      'Compare adverse-event incidence by arm and summarize serious grade 3+ events.',
      datasets,
    ),
    true,
  );
});

test('prioritizes a requested multi-file calculation over an incidental PDF hit', () => {
  assert.equal(
    shouldPrioritizeTabularAnalysisBeforePdf({
      hasTabularData: true,
      tabularQuestion: true,
      requiresSandbox: false,
      requiresMultiDatasetAnalysis: true,
    }),
    true,
  );
  assert.equal(
    shouldPrioritizeTabularAnalysisBeforePdf({
      hasTabularData: true,
      tabularQuestion: false,
      requiresSandbox: false,
      requiresMultiDatasetAnalysis: true,
    }),
    false,
  );
});

test('keeps document and table evidence together for compound questions', () => {
  assert.equal(
    requiresPdfAndTabularEvidence({
      text: 'In Figure 2, which subgroup is smallest, and how many matching subjects are in subjects.csv?',
      hasTabularData: true,
      tabularQuestion: true,
    }),
    true,
  );
  assert.equal(
    requiresPdfAndTabularEvidence({
      text: 'Which row has the largest value in subjects.csv?',
      hasTabularData: true,
      tabularQuestion: true,
    }),
    false,
  );
  assert.equal(
    requiresPdfAndTabularEvidence({
      text: 'Make a chart from subjects.csv.',
      hasTabularData: true,
      tabularQuestion: true,
    }),
    false,
  );
});

test('rejects an embedded CSV reconstruction while allowing inspected PDF values beside mounted rows', () => {
  const request = 'Use the report and sites.csv to calculate deviations per subject.';
  assert.match(
    analysisCodeValidationError(
      request,
      "from io import StringIO\nsites = pd.read_csv(StringIO('site_id,city\\nA,Paris'))",
    ) ?? '',
    /mounted uploaded file/u,
  );
  assert.equal(
    analysisCodeValidationError(
      request,
      "sites = pd.read_csv('data.csv')\ndeviations = {'A': 39}\nprint(deviations['A'])",
    ),
    undefined,
  );
  assert.match(
    analysisCodeValidationError(
      request,
      "sites = pd.DataFrame({'site_id': ['A'], 'city': ['Paris']})\nprint(sites)",
    ) ?? '',
    /mounted uploaded dataset/u,
  );
  assert.match(
    analysisCodeValidationError(
      request,
      "sites = [{'site_id': 'A', 'city': 'Paris'}]\nprint(sites)",
      { requiresMountedRead: true },
    ) ?? '',
    /mounted uploaded dataset/u,
  );
});

test('rejects a per-subject value copied from a raw count without division', () => {
  const request = 'Give protocol deviations per randomized subject.';
  assert.match(
    analysisCodeValidationError(
      request,
      "result = {'deviations_per_randomized_subject': deviations}\nprint(result)",
    ) ?? '',
    /never divides/u,
  );
  assert.equal(
    analysisCodeValidationError(
      request,
      "rate = deviations / enrolled\nresult = {'deviations_per_randomized_subject': rate}\nprint(result)",
    ),
    undefined,
  );
});

test('mounts every exact dataset filename read by generated code', () => {
  assert.deepEqual(
    tabularDatasetIdsReferencedByCode(
      'patients = pd.read_csv(\'patients.csv\')\nevents = pd.read_csv("adverse_events.csv")',
      datasets,
    ),
    ['patients', 'events'],
  );
});

test('routes a site missed-visit question to multi-dataset analysis from filenames and schemas', () => {
  assert.equal(
    requiresMultiDatasetAnalysis(
      'Which sites have the highest missed-visit rate? Include site name and status totals.',
      datasets,
    ),
    true,
  );
});

test('fresh multi-file questions never reuse the preceding analysis table', () => {
  assert.equal(
    shouldUseRecentAnalysisTable(
      'How many distinct patients have an out-of-range laboratory result and an adverse event?',
      datasets,
      true,
    ),
    false,
  );
  assert.equal(
    shouldUseRecentAnalysisTable('Calculate the average from this result.', datasets, true),
    true,
  );
});

test('routes biomarker drift, severity charts, and monitoring summaries across related schemas', () => {
  const prompts = [
    'Compare out-of-range biomarker percentages at visit 1 versus later visits by treatment arm. Which analyte/arm has the largest increase, and what are the two rates and percentage-point change?',
    'Generate a grouped adverse-event severity chart by arm, and summarize serious events and grade 3+ events for treatment versus control_placebo. The chart data must match the source tables.',
    'Create a concise clinical trial monitoring summary for both trials with a chart. Include status, target enrollment, current enrolled patients, enrollment gap, missed-visit risk, and safety signal. Keep each trial separate and state all source files used.',
  ];
  for (const prompt of prompts) {
    assert.equal(requiresMultiDatasetAnalysis(prompt, datasets), true, prompt);
  }
  assert.deepEqual(tabularDatasetIdsRequiredByQuestion(prompts[0], datasets).sort(), [
    'labs',
    'patients',
    'visits',
  ]);
  assert.deepEqual(tabularDatasetIdsRequiredByQuestion(prompts[1], datasets).sort(), [
    'events',
    'patients',
  ]);
  assert.deepEqual(tabularDatasetIdsRequiredByQuestion(prompts[2], datasets).sort(), [
    'patients',
    'trials',
  ]);
});

test('expands requested schemas through bridge tables for deterministic join planning', () => {
  assert.deepEqual(
    tabularDatasetIdsForAnalysis(
      'Find patients with abnormal lab results and adverse events.',
      datasets,
    ).sort(),
    ['events', 'labs', 'patients', 'sites', 'visits'],
  );
  assert.deepEqual(
    tabularDatasetIdsForAnalysis(
      'Which sites have the highest missed visit rate? Include site name and status totals.',
      datasets,
    ).sort(),
    ['events', 'labs', 'patients', 'sites', 'trials', 'visits'],
  );
});

test('exposes exact schema relationships to the analysis planner', () => {
  assert.deepEqual(
    tabularRelationships(datasets)
      .filter((relationship) => relationship.column === 'patient_id')
      .map((relationship) => [relationship.leftDatasetId, relationship.rightDatasetId]),
    [
      ['patients', 'events'],
      ['patients', 'visits'],
      ['events', 'visits'],
    ],
  );
});

test('stops after repeated failed analysis attempts but resets after a success', () => {
  const step = (exitCode: number) => ({
    toolResults: [{ toolName: 'executeAnalysis', output: { exitCode } }],
  });
  assert.equal(hasExhaustedAnalysisAttempts([step(1), step(1)], 3), false);
  assert.equal(hasExhaustedAnalysisAttempts([step(1), step(1), step(1)], 3), true);
  assert.equal(hasExhaustedAnalysisAttempts([step(1), step(0), step(1)], 2), false);
});

test('adds denominator, join, and chart validation requirements from user intent', () => {
  const requirements = analysisValidationRequirements(
    'Chart adverse event incidence per patient across files by arm.',
  );
  assert.match(requirements, /numerator and denominator separately/i);
  assert.match(requirements, /denominator from the complete subject or population table/i);
  assert.match(requirements, /percentages rounded to one decimal place/i);
  assert.match(requirements, /join keys/i);
  assert.match(requirements, /plotted grouping/i);
  assert.match(requirements, /source filenames/i);
  assert.match(
    analysisValidationRequirements('Create a monitoring summary for both trials.'),
    /human-readable code or name/i,
  );
  assert.match(
    analysisValidationRequirements('Compare visit 1 versus later visits.'),
    /never interpret a globally unique visit ID/i,
  );
  assert.match(
    analysisValidationRequirements(
      'Validate duplicates, orphan foreign keys, and adverse events before enrollment.',
    ),
    /explicit numeric zero/i,
  );
});

test('routes key integrity validation through tabular analysis', () => {
  assert.equal(
    isLikelyTabularQuestion({
      text: 'Validate primary key duplicates and orphan foreign keys.',
      columnNames: [],
      datasetNames: [],
    }),
    true,
  );
});

test('routes ranked entity rates through analysis instead of a lossy grouped query', () => {
  assert.equal(
    requiresTabularSandbox(
      'Which three sites have the highest missed-visit rates? Report missed count, scheduled count, and missed percentage for each, sorted highest first.',
    ),
    true,
  );
});

test('routes comparative risks and per-entity rates through reproducible analysis', () => {
  assert.equal(
    requiresTabularSandbox(
      'Which event has the largest absolute risk difference and which has the largest relative risk?',
    ),
    true,
  );
  assert.equal(requiresTabularSandbox('Report deviations per randomized subject.'), true);
});

test('routes exhaustive relational integrity validation through analysis', () => {
  assert.equal(
    requiresTabularSandbox(
      'Validate primary-key duplicates, orphan patient/visit foreign keys, and adverse-event onset dates before enrollment. Report every detected inconsistency.',
    ),
    true,
  );
});

test('routes longitudinal visit comparisons through related-table analysis', () => {
  assert.equal(
    requiresTabularSandbox(
      'Compare out-of-range biomarker percentages at visit 1 versus later visits by treatment arm. Which analyte/arm has the largest increase?',
    ),
    true,
  );
});

test('routes grouped severity charts through related-table analysis', () => {
  assert.equal(
    requiresTabularSandbox(
      'Generate a grouped adverse-event severity chart by arm, and summarize serious events and grade 3+ events.',
    ),
    true,
  );
});

test('routes multi-cohort charted monitoring summaries through analysis', () => {
  assert.equal(
    requiresTabularSandbox(
      'Create a concise clinical trial monitoring summary for both trials with a chart. Include status, target enrollment, current enrolled patients, enrollment gap, missed-visit risk, and safety signal.',
    ),
    true,
  );
});

test('keeps a calculation whose columns coexist in one dataset on the single-table path', () => {
  assert.equal(requiresMultiDatasetAnalysis('Compare average age by arm.', datasets), false);
});

test('routes composite dashboards and confidence intervals through code analysis', () => {
  assert.equal(
    requiresTabularSandbox('Generate a demographics dashboard with dropout rate by arm.'),
    true,
  );
  assert.equal(
    requiresTabularSandbox('Using complete cases, report a normal 95% confidence interval.'),
    true,
  );
});

test('resolves exact dataset filenames and stems to stored IDs without guessing', () => {
  assert.deepEqual(
    resolveTabularDatasetReferences(['patients.csv', 'adverse_events', 'visits'], datasets),
    ['patients', 'events', 'visits'],
  );
  assert.deepEqual(resolveTabularDatasetReferences(['missing.csv'], datasets), ['missing.csv']);
});

test('splits comma-serialized dataset references emitted in a scalar field', () => {
  assert.deepEqual(splitTabularDatasetReferences(['visits-id, sites-id']), [
    'visits-id',
    'sites-id',
  ]);
});

test('appends numeric zero counts for empty integrity findings', () => {
  assert.match(
    appendExplicitValidationZeroCounts(
      'Validate duplicates, orphan foreign keys, and events before enrollment.',
      "{'duplicated_visit_ids': [], 'orphan_patient_ids': [], 'events_before_enrollment': []}",
    ),
    /duplicated visit ids count: 0[\s\S]*orphan patient ids count: 0[\s\S]*events before enrollment count: 0/i,
  );
  assert.match(
    appendExplicitValidationZeroCounts(
      'Validate events before enrollment.',
      'ae_before_enrollment: 0',
    ),
    /ae before enrollment count: 0/i,
  );
});

test('normalizes displayed percentage evidence to one decimal by default', () => {
  assert.equal(
    normalizePercentagePrecisionInStdout(
      'Report missed count, scheduled count, and missed percentage.',
      'Munich 13 218 5.963303\nMadrid 12 225 5.333333\nBoston 18 351 5.128205',
    ),
    'Munich 13 218 5.963303\nMadrid 12 225 5.333333\nBoston 18 351 5.128205\ndisplay percentage values (1 decimal): 6.0, 5.3, 5.1',
  );
  assert.equal(
    normalizePercentagePrecisionInStdout('Report the value to 3 decimal places.', 'effect 4.321'),
    'effect 4.321',
  );
});

test('rejects treating a global visit foreign key as the visit sequence', () => {
  assert.match(
    analysisCodeValidationError(
      'Compare percentages at visit 1 versus later visits.',
      "visit1 = labs[labs['visit_id'] == 1]",
    ) ?? '',
    /visit_id is a relationship key/i,
  );
  assert.equal(
    analysisCodeValidationError(
      'Compare percentages at visit 1 versus later visits.',
      "visit1 = labs[labs['visit_number'] == 1]",
    ),
    undefined,
  );
  assert.match(
    analysisCodeValidationError(
      'Compare percentages at visit 1 versus later visits.',
      "labs['visit_group'] = labs['visit_id'].map(lambda x: 'visit_1' if x == 1 else 'later')",
    ) ?? '',
    /visit_id is a relationship key/i,
  );
});

test('rejects a safety incidence denominator derived from event-joined rows', () => {
  const invalid = [
    "merged = adae.merge(adsl, on='USUBJID')",
    "safety_pop = merged[merged['SAFFL'] == 'Y']",
    "safety_sizes = safety_pop.groupby('ARM')['USUBJID'].nunique()",
  ].join('\n');
  assert.match(
    analysisCodeValidationError(
      'Report the percent of safety subjects with a TEAE in each arm.',
      invalid,
    ) ?? '',
    /complete subject table/i,
  );
  assert.equal(
    analysisCodeValidationError(
      'Report the percent of safety subjects with a TEAE in each arm.',
      "safety_sizes = adsl[adsl['SAFFL'] == 'Y'].groupby('ARM')['USUBJID'].nunique()",
    ),
    undefined,
  );

  assert.match(
    analysisCodeValidationError(
      'Report the percent of safety subjects with a TEAE in each arm.',
      [
        "merged = adsl.merge(adae, on='USUBJID', how='left')",
        "merged['TEAE'] = merged['TRTEMFL'] == 'Y'",
        "teae_by_arm = merged.groupby('ARM')['TEAE'].mean()",
      ].join('\n'),
    ) ?? '',
    /weights subjects by their number of events/i,
  );
});

test('rejects summing event rows as the count of patients with any event', () => {
  assert.match(
    analysisCodeValidationError(
      'Report patients with any AE as a percentage.',
      [
        "merged['has_ae'] = merged['ae_id'].notnull()",
        "ae_patients = merged.groupby('arm').agg(patients_with_ae=('has_ae', 'sum'))",
      ].join('\n'),
    ) ?? '',
    /counts one patient repeatedly/i,
  );
  assert.equal(
    analysisCodeValidationError(
      'Report patients with any AE as a percentage.',
      "patients_with_ae = events.groupby('arm')['patient_id'].nunique()",
    ),
    undefined,
  );
  assert.equal(
    analysisCodeValidationError(
      'Report patients with any AE as a percentage.',
      [
        "patients['has_ae'] = patients['patient_id'].isin(ae_patients['patient_id'])",
        "summary = patients.groupby('arm').agg(patients_with_ae=('has_ae', 'sum'))",
      ].join('\n'),
    ),
    undefined,
  );
});

test('repairs opaque dataset ID typos only when code filenames identify every missing source', () => {
  const code = ["patients = pd.read_csv('patients.csv')", "sites = pd.read_csv('sites.csv')"].join(
    '\n',
  );
  assert.deepEqual(
    repairUnavailableTabularDatasetReferences(['patients', 'site-typo'], code, datasets),
    ['patients', 'sites'],
  );
  assert.deepEqual(
    repairUnavailableTabularDatasetReferences(
      ['patients', 'unknown-a', 'unknown-b'],
      code,
      datasets,
    ),
    ['patients', 'unknown-a', 'unknown-b'],
  );
});

test('remaps model-authored source filenames and dataset IDs to mounted sandbox files', () => {
  const manifest = {
    relationships: [],
    datasets: [
      {
        id: 'patients-id',
        fileName: 'patients.csv',
        file: 'dataset-1.csv',
        rowCount: 10,
        columns: ['patient_id', 'arm'],
      },
      {
        id: 'events-id',
        fileName: 'adverse_events.csv',
        file: 'dataset-2.csv',
        rowCount: 20,
        columns: ['patient_id', 'serious'],
      },
    ],
  };
  const code = [
    "patients = pd.read_csv('patients.csv')",
    'events = pd.read_csv("/mnt/data/events-id.csv")',
    "external = pd.read_csv('unrelated.csv')",
  ].join('\n');

  assert.equal(
    remapMountedDatasetReads(code, manifest),
    [
      "patients = pd.read_csv('dataset-1.csv')",
      'events = pd.read_csv("dataset-2.csv")',
      "external = pd.read_csv('unrelated.csv')",
    ].join('\n'),
  );
});
