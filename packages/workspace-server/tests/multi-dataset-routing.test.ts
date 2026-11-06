import assert from 'node:assert/strict';
import test from 'node:test';
import type { TabularDatasetMeta } from '@larkup/core/tabular-store';
import {
  requiresMultiDatasetAnalysis,
  resolveTabularDatasetReferences,
  tabularDatasetIdsRequiredByQuestion,
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

test('routes a site missed-visit question to multi-dataset analysis from filenames and schemas', () => {
  assert.equal(
    requiresMultiDatasetAnalysis(
      'Which sites have the highest missed-visit rate? Include site name and status totals.',
      datasets,
    ),
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

test('keeps a calculation whose columns coexist in one dataset on the single-table path', () => {
  assert.equal(requiresMultiDatasetAnalysis('Compare average age by arm.', datasets), false);
});

test('resolves exact dataset filenames and stems to stored IDs without guessing', () => {
  assert.deepEqual(
    resolveTabularDatasetReferences(['patients.csv', 'adverse_events', 'visits'], datasets),
    ['patients', 'events', 'visits'],
  );
  assert.deepEqual(resolveTabularDatasetReferences(['missing.csv'], datasets), ['missing.csv']);
});

test('remaps model-authored source filenames and dataset IDs to mounted sandbox files', () => {
  const manifest = {
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
