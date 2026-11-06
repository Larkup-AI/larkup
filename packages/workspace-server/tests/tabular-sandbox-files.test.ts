import assert from 'node:assert/strict';
import test from 'node:test';
import type { TabularDataset } from '@larkup/core/tabular-store';
import {
  createTabularSandboxFiles,
  printBareFinalPythonExpression,
  remapBooleanStringLiterals,
  remapSavedFiguresToShow,
  remapSingleDatasetColumnReferences,
} from '../src/lib/chat/tabular-sandbox-files.ts';

const needs = 'Question 2: Current Needs: "What would you benefit from most right now?"';
const notes =
  "Question 3: \"Anything else you'd like to add? Share what you're bringing to the table or what you're looking for.\"";

const dataset = {
  columns: [needs, notes].map((name) => ({ name, type: 'string' as const, nullCount: 0 })),
} as TabularDataset;

test('repairs unambiguous shortened form-export column names', () => {
  const code = "selected = frame[['Question 2: Current Needs']]";
  const repaired = remapSingleDatasetColumnReferences(code, dataset);

  assert.equal(repaired, `selected = frame[[${JSON.stringify(needs)}]]`);
});

test('repairs malformed Python strings containing apostrophes', () => {
  const code = `selected = frame[['Question 3: "Anything else you'd like to add? Share what you're bringing to the table or what you're looking for."']]`;
  const repaired = remapSingleDatasetColumnReferences(code, dataset);

  assert.equal(repaired, `selected = frame[[${JSON.stringify(notes)}]]`);
});

test('normalizes smart-quote variants back to the exact stored heading', () => {
  const code = `selected = frame[["Question 3: Anything else you’d like to add? Share what you’re bringing to the table or what you’re looking for."]]`;
  const repaired = remapSingleDatasetColumnReferences(code, dataset);

  assert.equal(repaired, `selected = frame[[${JSON.stringify(notes)}]]`);
});

test('does not guess when a shortened heading matches multiple columns', () => {
  const ambiguous = {
    columns: [
      { name: 'Question 2: Current Needs: First answer', type: 'string', nullCount: 0 },
      { name: 'Question 2: Current Needs: Second answer', type: 'string', nullCount: 0 },
    ],
  } as TabularDataset;
  const code = "selected = frame[['Question 2: Current Needs']]";

  assert.equal(remapSingleDatasetColumnReferences(code, ambiguous), code);
});

test('publishes exact join keys and uniqueness hints in the sandbox manifest', () => {
  const makeDataset = (id: string, fileName: string, rows: Array<Record<string, string>>) =>
    ({
      id,
      fileName,
      rows,
      rowCount: rows.length,
      columns: Object.keys(rows[0]).map((name) => ({
        name,
        type: 'string' as const,
        nullCount: 0,
        uniqueCount: new Set(rows.map((row) => row[name])).size,
      })),
    }) as TabularDataset;
  const mounted = createTabularSandboxFiles([
    makeDataset('subjects', 'subjects.csv', [
      { subject_id: 's1', arm: 'A' },
      { subject_id: 's2', arm: 'B' },
    ]),
    makeDataset('events', 'events.csv', [
      { event_id: 'e1', subject_id: 's1' },
      { event_id: 'e2', subject_id: 's1' },
    ]),
  ]);
  assert.deepEqual(mounted.manifest?.relationships, [
    {
      leftDatasetId: 'subjects',
      rightDatasetId: 'events',
      leftColumn: 'subject_id',
      rightColumn: 'subject_id',
      leftUnique: true,
      rightUnique: false,
    },
  ]);
});

test('prints a notebook style final expression without making assignments visible', () => {
  assert.equal(
    printBareFinalPythonExpression('result = frame.groupby("arm").size()\nresult'),
    'result = frame.groupby("arm").size()\nprint(repr(result))',
  );
  assert.equal(
    printBareFinalPythonExpression('patient_count = 10\n(patient_count, 3, 2)'),
    'patient_count = 10\nprint(repr((patient_count, 3, 2)))',
  );
  assert.equal(printBareFinalPythonExpression('value = 1'), 'value = 1');
});

test('repairs boolean string comparisons only for parsed boolean columns', () => {
  const booleanDataset = {
    columns: [
      { name: 'completed', type: 'string', nullCount: 0 },
      { name: 'label', type: 'string', nullCount: 0 },
    ],
    rows: [
      { completed: 'True', label: 'True story' },
      { completed: 'False', label: 'False alarm' },
    ],
  } as TabularDataset;
  assert.equal(
    remapBooleanStringLiterals(
      `missed = frame[frame['completed'] == 'False']\nvalid = frame['completed'].map({'True': True, 'False': False})`,
      [booleanDataset],
    ),
    `missed = frame[frame['completed'] == False]\nvalid = frame['completed'].map({True: True, False: False})`,
  );
  assert.equal(
    remapBooleanStringLiterals(`selected = frame[frame['label'] == 'True']`, [booleanDataset]),
    `selected = frame[frame['label'] == 'True']`,
  );
});

test('uses the sandbox display hook for model authored saved figures', () => {
  assert.equal(
    remapSavedFiguresToShow("plt.plot(values)\nplt.savefig('chart.png')"),
    'plt.plot(values)\nplt.show()',
  );
});
