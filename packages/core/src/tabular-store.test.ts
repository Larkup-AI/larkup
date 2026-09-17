import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyzeColumns,
  aggregateTabularValues,
  boundTabularRows,
  DEFAULT_TABULAR_RESULT_LIMIT,
  MAX_TABULAR_RESULT_LIMIT,
} from './tabular-store';

test('counts text values and distinct identifiers without numeric coercion', () => {
  const values = ['ORD-1', 'ORD-2', 'ORD-1', '', null, undefined];

  assert.equal(aggregateTabularValues('count', values), 3);
  assert.equal(aggregateTabularValues('countDistinct', values), 2);
});

test('does not classify identifier-like values as dates', () => {
  const columns = analyzeColumns(
    [{ customerId: 'CG-12520' }, { customerId: 'DV-13045' }, { customerId: 'SO-20335' }],
    ['customerId'],
  );

  assert.equal(columns[0]?.name, 'customerId');
  assert.equal(columns[0]?.type, 'string');
  assert.equal(columns[0]?.dateRange, undefined);
});

test('keeps explicit ISO date values as dates', () => {
  const columns = analyzeColumns(
    [{ orderedAt: '2017-01-02' }, { orderedAt: '2017-02-03' }, { orderedAt: '2017-03-04' }],
    ['orderedAt'],
  );

  assert.equal(columns[0]?.name, 'orderedAt');
  assert.equal(columns[0]?.type, 'date');
  assert.deepEqual(columns[0]?.dateRange, {
    min: '2017-01-02',
    max: '2017-03-04',
    format: 'YYYY-MM-DD',
  });
});

test('bounds raw tabular result pages without changing the total result count', () => {
  const rows = Array.from({ length: 800 }, (_, id) => ({ id }));

  const defaultPage = boundTabularRows(rows);
  assert.equal(defaultPage.rows.length, DEFAULT_TABULAR_RESULT_LIMIT);
  assert.equal(defaultPage.totalRows, 800);
  assert.equal(defaultPage.truncated, true);

  const requestedPage = boundTabularRows(rows, 1_000);
  assert.equal(requestedPage.rows.length, MAX_TABULAR_RESULT_LIMIT);
  assert.equal(requestedPage.totalRows, 800);
  assert.equal(requestedPage.truncated, true);
});

test('marks a complete small tabular result as untruncated', () => {
  const page = boundTabularRows([{ id: 1 }, { id: 2 }], 20);

  assert.equal(page.rows.length, 2);
  assert.equal(page.totalRows, 2);
  assert.equal(page.truncated, false);
});
