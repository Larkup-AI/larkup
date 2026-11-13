import { expect, test } from '@playwright/test';
import {
  structuredAnalysisPlanSchema,
  compileStructuredAnalysisPlan,
} from '../../../packages/workspace-server/src/lib/chat/structured-analysis-plan';

test('structured analysis rejects unknown columns before execution and preserves typed coverage', () => {
  const plan = structuredAnalysisPlanSchema.parse({
    groupBy: ['region'],
    category: 'category',
    measure: 'amount',
    units: 'MW',
    filters: [{ column: 'status', values: ['active'] }],
    expectedGroups: 3,
    output: 'winners',
  });
  expect(() => compileStructuredAnalysisPlan(plan, ['region', 'category', 'amount'])).toThrow(
    /unknown column/i,
  );
  const source = compileStructuredAnalysisPlan(plan, ['region', 'category', 'amount', 'status']);
  expect(source).toContain('Population coverage failed');
  expect(source).toContain('Aggregated total differs');
  expect(source).toContain('_result[_measure] == _maximum');
});
