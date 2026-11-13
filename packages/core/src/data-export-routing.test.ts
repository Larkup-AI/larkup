import assert from 'node:assert/strict';
import test from 'node:test';
import { requestedDataExportFormat } from './workspace-common/chat/data-export';

test('source formats do not request exports of generated charts', () => {
  assert.equal(
    requestedDataExportFormat(
      'Create a stacked chart from the plant CSV. Include the aggregated chart data.',
    ),
    undefined,
  );
  assert.equal(
    requestedDataExportFormat('Generate a chart using the supplied Excel spreadsheet.'),
    undefined,
  );
});
test('an explicit output format remains available beside a source format', () => {
  assert.equal(requestedDataExportFormat('Create a report from the CSV as PDF.'), 'pdf');
  assert.equal(requestedDataExportFormat('Export this as CSV.'), 'csv');
});
