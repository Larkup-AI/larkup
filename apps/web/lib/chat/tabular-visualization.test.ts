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
});
