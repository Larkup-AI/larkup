import assert from 'node:assert/strict';
import test from 'node:test';
import type { TabularDataset } from '@larkup/core/tabular-store';
import {
  createTabularSandboxFiles,
  printBareFinalPythonExpression,
  remapSimplePythonPrints,
  printBareTopLevelPythonTuples,
  repairAccidentalTopLevelPythonIndent,
  remapBooleanStringLiterals,
  remapSavedFiguresToShow,
  repairEscapedPythonClosingQuote,
  repairMissingPandasMergeKeySuffix,
  repairMissingPandasMergeColumnSuffix,
  repairSuggestedPythonNameError,
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

test('repairs accidental one-space indentation on generated top-level Python statements', () => {
  assert.equal(
    repairAccidentalTopLevelPythonIndent(
      "import pandas as pd\n data = pd.read_csv('data.csv')\nif ready:\n    print(data)",
    ),
    "import pandas as pd\ndata = pd.read_csv('data.csv')\nif ready:\n    print(data)",
  );
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
    'result = frame.groupby("arm").size()\n_larkup_print_result(result)',
  );
  assert.equal(
    printBareFinalPythonExpression('patient_count = 10\n(patient_count, 3, 2)'),
    'patient_count = 10\n_larkup_print_result(((patient_count, 3, 2)))',
  );
  assert.equal(
    printBareFinalPythonExpression("result = frame.head(3)\nresult.to_dict(orient='records')"),
    "result = frame.head(3)\n_larkup_print_result(result.to_dict(orient='records'))",
  );
  assert.equal(
    printBareFinalPythonExpression(
      "result = {'duplicates': 0}\ndetails = frame.head(0)\nresult, details.to_dict(orient='records')",
    ),
    "result = {'duplicates': 0}\ndetails = frame.head(0)\n_larkup_print_result((result, details.to_dict(orient='records')))",
  );
  assert.equal(
    printBareFinalPythonExpression(
      'count = 10\nexamples = [1, 2]\ncount, examples, "joined on patient_id"',
    ),
    'count = 10\nexamples = [1, 2]\n_larkup_print_result((count, examples, "joined on patient_id"))',
  );
  assert.equal(
    printBareFinalPythonExpression(
      `summary = frame.groupby('trial_id').size()
summary[['trial_code', 'current_enrolled']], ['trials.csv', 'patients.csv']`,
    ),
    `summary = frame.groupby('trial_id').size()
_larkup_print_result((summary[['trial_code', 'current_enrolled']], ['trials.csv', 'patients.csv']))`,
  );
  assert.equal(
    printBareFinalPythonExpression(
      `final_summary = {
    'Total Subjects': total_subjects,
    'Total Sites': total_sites,
    'Arm Summary': summary,
}
final_summary['Arm Summary']`,
    ),
    `final_summary = {
    'Total Subjects': total_subjects,
    'Total Sites': total_sites,
    'Arm Summary': summary,
}
_larkup_print_result(final_summary)`,
  );
  assert.equal(
    printBareFinalPythonExpression(
      `result = frame.iloc[0]\nresult[['analyte', 'arm', 'percentage_point_change']]`,
    ),
    `result = frame.iloc[0]\nprint((result[['analyte', 'arm', 'percentage_point_change']]).to_string(index=False))`,
  );
  assert.equal(printBareFinalPythonExpression('value = 1'), 'value = 1');
  assert.equal(
    printBareFinalPythonExpression(
      `summary = "ready"
{
    "summary_text": summary,
    "source_files": ["trials.csv", "patients.csv"],
}`,
    ),
    `summary = "ready"
print(repr(({
    "summary_text": summary,
    "source_files": ["trials.csv", "patients.csv"],
})))`,
  );
});

test('routes simple dataframe prints through the stable result formatter', () => {
  assert.equal(
    remapSimplePythonPrints('result = frame.head()\nprint(result)'),
    'result = frame.head()\n_larkup_print_result(result)',
  );
});

test('does not rewrite descriptive f-strings as schema column references', () => {
  const dataset = {
    id: 'trial',
    fileName: 'trial.csv',
    columns: [{ name: 'arm', type: 'string' as const, nullCount: 0, uniqueCount: 2 }],
    rows: [{ arm: 'treatment' }],
    summary: {
      totalRows: 1,
      totalColumns: 1,
      numericColumns: 0,
      categoricalColumns: 1,
      dateColumns: 0,
    },
    rowCount: 1,
    createdAt: '2026-11-06T00:00:00.000Z',
  };
  const code = `label = f'Dropout Rate in {row["arm"]}'`;
  assert.equal(remapSingleDatasetColumnReferences(code, dataset), code);
});

test('prints a top-level scalar tuple before later explanation code', () => {
  assert.equal(
    printBareTopLevelPythonTuples(
      'lab_critical_high_count, serious_ae_count\nexplanation = "independent counts"\nprint(explanation)',
    ),
    '_larkup_print_result((lab_critical_high_count, serious_ae_count))\nexplanation = "independent counts"\nprint(explanation)',
  );
});

test('prints a notebook summary paired with a plotting call', () => {
  assert.equal(
    printBareTopLevelPythonTuples('summary, plt.show()\nplt.show()'),
    '_larkup_print_result((summary, plt.show()))\nplt.show()',
  );
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
  assert.equal(
    remapBooleanStringLiterals(`out_of_range = frame['completed'].str.lower().eq('true').sum()`, [
      booleanDataset,
    ]),
    `out_of_range = frame['completed'].eq(True).sum()`,
  );
  assert.equal(
    remapBooleanStringLiterals(`out_of_range = frame['completed'].str.lower() == 'true'`, [
      booleanDataset,
    ]),
    `out_of_range = frame['completed'] == True`,
  );
});

test('repairs a left-merge match test that incorrectly expects a suffixed join key', () => {
  const code = [
    "joined = pd.merge(patients[['patient_id', 'arm']], events[['patient_id']], on='patient_id', how='left')",
    "joined['had_event'] = ~joined['patient_id_y'].isna()",
  ].join('\n');
  assert.equal(
    repairMissingPandasMergeKeySuffix(code, "KeyError: 'patient_id_y'"),
    [
      "joined = pd.merge(patients[['patient_id', 'arm']], events[['patient_id']], on='patient_id', how='left', indicator=True)",
      "joined['had_event'] = joined['_merge'].eq('both')",
    ].join('\n'),
  );
});

test('repairs access to a duplicated non-key pandas merge column', () => {
  const safetyDataset = {
    columns: [{ name: 'SAFFL', type: 'string', nullCount: 0 }],
    rows: [{ SAFFL: 'Y' }],
  } as TabularDataset;
  const code = [
    "joined = events.merge(subjects[['USUBJID', 'SAFFL']], on='USUBJID', how='left')",
    "safety = joined[joined['SAFFL'] == 'Y']",
  ].join('\n');
  assert.equal(
    repairMissingPandasMergeColumnSuffix(code, "KeyError: 'SAFFL'", [safetyDataset, safetyDataset]),
    [
      "joined = events.merge(subjects[['USUBJID', 'SAFFL']], on='USUBJID', how='left')",
      "safety = joined[joined['SAFFL_x'] == 'Y']",
    ].join('\n'),
  );
});

test('uses the sandbox display hook for model authored saved figures', () => {
  assert.equal(
    remapSavedFiguresToShow("plt.plot(values)\nplt.savefig('chart.png')"),
    'plt.plot(values)\nplt.show()',
  );
});

test('repairs an identifier using Python own NameError suggestion', () => {
  assert.equal(
    repairSuggestedPythonNameError(
      "pivot = frame.copy()\ntivot['change'] = 1",
      "NameError: name 'tivot' is not defined. Did you mean: 'pivot'?",
    ),
    "pivot = frame.copy()\npivot['change'] = 1",
  );
});

test('repairs a terminal escaped quote that leaves a Python string unclosed', () => {
  assert.equal(
    repairEscapedPythonClosingQuote(
      `summary.append(f"Safety signal: {int(row['serious_count'])}\\")`,
    ),
    `summary.append(f"Safety signal: {int(row['serious_count'])}")`,
  );
});
