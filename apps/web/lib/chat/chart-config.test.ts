import { describe, expect, it } from 'vitest';
import { normalizeChartConfig } from './chart-config';

describe('normalizeChartConfig', () => {
  it('drops placeholder fields and infers real axes and series from all rows', () => {
    const chart = normalizeChartConfig({
      chartType: 'line',
      title: 'Dropout comparison',
      data: [
        { University: 'North', __EMPTY: 0.55, International: '16%', Domestic: '13%' },
        { University: 'South', __EMPTY: 0.27, International: '49%', Domestic: '26%' },
      ],
      xAxisKey: '__EMPTY',
      series: [
        { dataKey: '__EMPTY', label: '__EMPTY' },
        { dataKey: 'does not exist', label: 'EMPTY_1' },
      ],
    });

    expect(chart.error).toBeUndefined();
    expect(chart.xAxisKey).toBe('University');
    expect(chart.series).toEqual([
      { dataKey: 'International', label: 'International' },
      { dataKey: 'Domestic', label: 'Domestic' },
    ]);
    expect(chart.data).toEqual([
      { University: 'North', International: 16, Domestic: 13 },
      { University: 'South', International: 49, Domestic: 26 },
    ]);
  });

  it('does not turn an invalid second series into a duplicate of a valid one', () => {
    const chart = normalizeChartConfig({
      chartType: 'bar',
      title: 'Revenue',
      data: [
        { Region: 'East', Revenue: 40, Cost: 22 },
        { Region: 'West', Revenue: 52, Cost: 31 },
      ],
      xAxisKey: 'Region',
      series: [
        { dataKey: 'Revenue', label: 'Revenue' },
        { dataKey: 'not-a-column', label: 'EMPTY' },
      ],
    });

    expect(chart.series).toEqual([{ dataKey: 'Revenue', label: 'Revenue' }]);
    expect(chart.data).toEqual([
      { Region: 'East', Revenue: 40 },
      { Region: 'West', Revenue: 52 },
    ]);
  });

  it('reports unusable data instead of producing a blank Recharts canvas', () => {
    const chart = normalizeChartConfig({
      chartType: 'bar',
      title: 'Broken chart',
      data: [{ __EMPTY: 1 }, { __EMPTY: 2 }],
      xAxisKey: '__EMPTY',
      series: [{ dataKey: '__EMPTY' }],
    });

    expect(chart.data).toEqual([]);
    expect(chart.series).toEqual([]);
    expect(chart.error).toBe('No usable category or X-axis field was provided.');
  });
});
