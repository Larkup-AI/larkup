import { describe, expect, it } from 'vitest';
import { createTabularVisualization } from './tabular-visualization';

describe('createTabularVisualization', () => {
  it('uses a line chart for a time trend', () => {
    expect(
      createTabularVisualization("What's the monthly revenue trend?", {
        columns: ['Date_month', 'sum_Revenue'],
        rows: [
          { Date_month: '2025-01', sum_Revenue: 100 },
          { Date_month: '2025-02', sum_Revenue: 150 },
        ],
      }),
    ).toMatchObject({
      chartType: 'line',
      xAxisKey: 'Date_month',
      series: [{ dataKey: 'sum_Revenue', label: 'sum_Revenue' }],
    });
  });

  it('never exposes empty spreadsheet columns as chart labels', () => {
    expect(
      createTabularVisualization('show a comparison chart', {
        columns: ['__EMPTY', 'University', 'International dropout', 'Domestic dropout'],
        rows: [
          {
            __EMPTY: 'ignored',
            University: 'North',
            'International dropout': '16%',
            'Domestic dropout': '13%',
          },
          {
            __EMPTY: 'ignored',
            University: 'South',
            'International dropout': '49%',
            'Domestic dropout': '26%',
          },
        ],
      }),
    ).toMatchObject({
      xAxisKey: 'University',
      series: [
        { dataKey: 'International dropout', label: 'International dropout' },
        { dataKey: 'Domestic dropout', label: 'Domestic dropout' },
      ],
    });
  });
});
