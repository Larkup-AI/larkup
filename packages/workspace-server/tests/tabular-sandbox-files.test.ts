import assert from 'node:assert/strict';
import test from 'node:test';
import type { TabularDataset } from '@larkup/core/tabular-store';
import { remapSingleDatasetColumnReferences } from '../src/lib/chat/tabular-sandbox-files.ts';

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
