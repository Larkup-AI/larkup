import assert from 'node:assert/strict';
import test from 'node:test';
import { validateAnalysisCompleteness } from '../src/lib/chat/analysis-completeness';

const table = (count: number) => ({
  kind: 'table' as const,
  title: 'Winners',
  columns: ['Region', 'Category'],
  rows: Array.from({ length: count }, (_, index) => ({ Region: `Region ${index}`, Category: 'A' })),
  totalItems: count,
  complete: true,
});
test('one-winner-per-group reports reject extra populations instead of claiming completeness', () => {
  const result = validateAnalysisCompleteness(
    'Give the dominant category for all 5 eligible regions.',
    table(6),
  );
  assert.equal(result.valid, false);
  assert.match(result.error ?? '', /population|scope/i);
  assert.equal(
    validateAnalysisCompleteness('Give the dominant category for all 5 eligible regions.', table(5))
      .valid,
    true,
  );
});
test('a multi-series chart is not constrained to one row per requested group', () => {
  assert.equal(
    validateAnalysisCompleteness('Chart every category for all 5 regions.', table(20)).valid,
    true,
  );
});

test('a requested chart data table cannot be replaced with chart pixels or stdout', () => {
  const request = 'Create a stacked chart and include the aggregated chart data.';
  assert.equal(validateAnalysisCompleteness(request, undefined).valid, false);
  assert.equal(validateAnalysisCompleteness(request, table(12)).valid, true);
  assert.equal(validateAnalysisCompleteness('Create a chart.', undefined).valid, true);
});

test('explicit group coverage requires a verifiable table before it can pass', () => {
  assert.equal(
    validateAnalysisCompleteness(
      'Give the dominant category for all 5 eligible regions.',
      undefined,
    ).valid,
    false,
  );
});

test('verified winner plans count distinct groups while preserving tied winners', () => {
  const result = { ...table(6), rows: [...table(5).rows, table(5).rows[0]] };
  assert.equal(
    validateAnalysisCompleteness(
      'Give the dominant category for all 5 eligible regions.',
      result,
      undefined,
      ['Region'],
    ).valid,
    true,
  );
});
