import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  structuredAnalysisPlanSchema,
  compileStructuredAnalysisPlan,
} from '../src/lib/chat/structured-analysis-plan';

function run(plan: unknown) {
  const directory = mkdtempSync(join(tmpdir(), 'analysis-plan-'));
  try {
    writeFileSync(
      join(directory, 'data.csv'),
      'region,kind,amount,country,status,year\nA,x,2,AA,on,1992\nA,y,3,AA,on,1994\nB,x,4,AA,on,2001\nB,y,4,AA,on,2004\nC,x,99,BB,on,2001\nA,z,12,AA,off,2001\n',
    );
    const code = compileStructuredAnalysisPlan(structuredAnalysisPlanSchema.parse(plan), [
      'region',
      'kind',
      'amount',
      'country',
      'status',
      'year',
    ]);
    return execFileSync(
      'python3',
      [
        '-c',
        `def larkup_table(title, rows, **kwargs):\n    print(rows.to_json(orient="records"))\n${code}`,
      ],
      { cwd: directory, encoding: 'utf8' },
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
const base = {
  groupBy: ['region'],
  category: 'kind',
  measure: 'amount',
  units: 'MW',
  filters: [
    { column: 'country', values: ['AA'] },
    { column: 'status', values: ['on'] },
  ],
  expectedGroups: 2,
  output: 'winners',
};
test('structured aggregation filters before ranking and preserves ties', () => {
  const rows = JSON.parse(run(base));
  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.map((r: any) => [r.region, r.kind, r.amount]),
    [
      ['A', 'y', 3],
      ['B', 'x', 4],
      ['B', 'y', 4],
    ],
  );
});
test('coverage checks count distinct populations and reject an omitted scope filter', () => {
  assert.throws(() => run({ ...base, filters: [base.filters[1]] }), /population coverage/i);
});
test('chart matrix preserves categories and reconciles to the filtered total', () => {
  const rows = JSON.parse(
    run({
      ...base,
      groupBy: ['year'],
      decadeColumn: 'year',
      expectedGroups: undefined,
      output: 'table',
    }),
  );
  assert.equal(
    rows.reduce((sum: number, r: any) => sum + r.amount, 0),
    13,
  );
  assert.deepEqual([...new Set(rows.map((r: any) => r.kind))], ['x', 'y']);
});
test('invalid plan fields are rejected before execution', () => {
  assert.throws(
    () =>
      compileStructuredAnalysisPlan(
        structuredAnalysisPlanSchema.parse({ ...base, measure: 'invented' }),
        ['region', 'kind', 'amount', 'country', 'status'],
      ),
    /unknown column/i,
  );
  assert.equal(
    structuredAnalysisPlanSchema.safeParse({ ...base, expectedGroups: -1 }).success,
    false,
  );
});
