import assert from 'node:assert/strict';
import test from 'node:test';
import { validateChartIntent } from '../src/lib/chat/tabular-visualization.ts';

const rows = [
  { arm: 'Treatment', severity: 'Severe', relatedness: 'Related', count: 4 },
  { arm: 'Control', severity: 'Mild', relatedness: 'Unrelated', count: 6 },
];

test('rejects an authoritative but incorrectly grouped chart', () => {
  const result = validateChartIntent(
    'Create an adverse event severity chart by arm.',
    {
      chartType: 'bar',
      title: 'Relatedness',
      data: rows,
      xAxisKey: 'relatedness',
      series: [{ dataKey: 'count', label: 'Count' }],
      showLegend: true,
    },
    rows,
  );
  assert.deepEqual(result.data, []);
  assert.match(String(result.error), /requested grouping/i);
});

test('accepts a chart whose grouping matches the requested intent', () => {
  const result = validateChartIntent(
    'Create an adverse event severity chart by arm.',
    {
      chartType: 'bar',
      title: 'Severity by arm',
      data: rows,
      xAxisKey: 'arm',
      series: [{ dataKey: 'count', label: 'Count' }],
      showLegend: true,
    },
    rows,
  );
  assert.equal(result.error, undefined);
  assert.equal(result.data.length, 2);
});
