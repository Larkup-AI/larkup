import { expect, test } from '@playwright/test';
import { compactToolContextForModel } from '../../../apps/web/lib/chat/tool-context';
import {
  createTabularVisualization,
  requestsVisualization,
} from '../../../apps/web/lib/chat/tabular-visualization';

test('bounds retrieved source payloads before the next model step', () => {
  const compacted = compactToolContextForModel([
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolName: 'searchKnowledgeBase',
          output: {
            type: 'json',
            value: {
              query: 'views under Resources',
              hits: Array.from({ length: 8 }, (_, index) => ({
                documentId: String(index),
                title: `Source ${index}`,
                text: 'x'.repeat(5_000),
                metadata: { images: Array.from({ length: 10 }, () => ({ description: 'large' })) },
              })),
            },
          },
        },
      ],
    },
  ]);

  const value = compacted[0].content[0].output.value;
  expect(value.hits).toHaveLength(4);
  expect(value.hits[0].text).toHaveLength(1_200);
  expect(value.hits[0].metadata).not.toHaveProperty('images');
});

test('creates a chart from a queried grouped result without another model tool call', () => {
  expect(requestsVisualization('show me distribution over sales by area')).toBe(true);
  expect(
    createTabularVisualization('show me distribution over sales by area', {
      columns: ['Region', 'sum_Net Revenue'],
      rows: [
        { Region: 'East', 'sum_Net Revenue': 535_384.44 },
        { Region: 'North', 'sum_Net Revenue': 717_478.74 },
      ],
    }),
  ).toMatchObject({
    chartType: 'bar',
    xAxisKey: 'Region',
    series: [{ dataKey: 'sum_Net Revenue' }],
  });
});
