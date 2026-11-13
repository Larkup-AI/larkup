import { z } from 'zod';

/** Declarative sums use one verified table for ranking, charting, and export. */
export const structuredAnalysisPlanSchema = z.object({
  groupBy: z
    .array(z.string())
    .min(1)
    .max(4)
    .describe(
      'Population axes only, excluding category and measure. For winners by region use [region]; for a decade chart use [year].',
    ),
  category: z
    .string()
    .describe(
      'The category being compared, ranked, or stacked. Use the exact requested fine-grained source column, never a status filter or a coarser classification.',
    ),
  measure: z.string().describe('Numeric source column to SUM after applying every filter.'),
  units: z.string().describe('Units from the source field definition, never inferred from values.'),
  filters: z
    .array(
      z.object({
        column: z.string(),
        values: z
          .array(z.union([z.string(), z.number(), z.boolean()]))
          .min(1)
          .max(100),
      }),
    )
    .max(12)
    .describe(
      'All requested population constraints, including geography and status, before aggregation. Use exact observed source values; empty only for an explicitly unfiltered population.',
    ),
  decadeColumn: z
    .string()
    .optional()
    .describe('A numeric commissioning year column, also listed in groupBy; floor to decade.'),
  expectedGroups: z
    .number()
    .int()
    .positive()
    .max(10000)
    .optional()
    .describe(
      'Only an explicit user-requested number of distinct groups. Omit when unspecified; never guess or use the maximum.',
    ),
  output: z.enum(['table', 'winners', 'stacked-bar']),
});
export type StructuredAnalysisPlan = z.infer<typeof structuredAnalysisPlanSchema>;

export function compileStructuredAnalysisPlan(
  plan: StructuredAnalysisPlan,
  columns: string[],
): string {
  const required = [
    ...plan.groupBy,
    plan.category,
    plan.measure,
    ...plan.filters.map((f) => f.column),
    ...(plan.decadeColumn ? [plan.decadeColumn] : []),
  ];
  const missing = required.find((column) => !columns.includes(column));
  if (missing)
    throw new Error(
      `Unknown column in analysis plan: ${missing}. Available: ${columns.join(', ')}`,
    );
  if (new Set([...plan.groupBy, plan.category, plan.measure]).size !== plan.groupBy.length + 2)
    throw new Error('Grouping, category, and measure columns must be distinct.');
  if (plan.decadeColumn && !plan.groupBy.includes(plan.decadeColumn))
    throw new Error('The decade column must be a grouping column.');
  if (plan.output === 'stacked-bar' && plan.groupBy.length !== 1)
    throw new Error('Stacked bars require exactly one grouping column.');
  const encoded = Buffer.from(JSON.stringify(plan)).toString('base64');
  return `import pandas as pd, json, base64, math
_p = json.loads(base64.b64decode('${encoded}'))
_raw = pd.read_csv('data.csv')
_df = _raw.copy()
for _f in _p['filters']:
    _observed = _df[_f['column']].dropna().unique().tolist()
    assert all(_v in _observed for _v in _f['values']), 'Unknown filter value for ' + _f['column'] + ': observed ' + repr(_observed[:30])
    _df = _df[_df[_f['column']].isin(_f['values'])].copy()
assert len(_df), 'The selected population is empty.'
_groups = _p['groupBy']
_category = _p['category']
_measure = _p['measure']
_df[_measure] = pd.to_numeric(_df[_measure], errors='raise')
assert _df[_measure].notna().all(), 'Missing measure values: cannot verify totals.'
assert _df[_measure].map(math.isfinite).all(), 'Nonfinite measure values.'
if _p.get('decadeColumn'):
    _year = pd.to_numeric(_df[_p['decadeColumn']], errors='raise')
    assert _year.notna().all(), 'Missing year values: cannot verify decade coverage.'
    _df[_p['decadeColumn']] = (_year // 10 * 10).astype(int)
for _column in _groups + [_category]:
    assert not (_df[_column].isna().any() and _df[_column].eq('(missing)').any()), 'Missing-value label conflicts with an existing category.'
    _df[_column] = _df[_column].fillna('(missing)')
_count = len(_df[_groups].drop_duplicates())
if _p.get('expectedGroups'):
    _scope = {str(c): _raw[c].dropna().unique().tolist() for c in _raw.columns if _raw[c].nunique() <= 20}
    assert _count == _p['expectedGroups'], 'Population coverage failed: got ' + str(_count) + ', expected ' + str(_p['expectedGroups']) + '. Recheck scope filters using observed values: ' + repr(_scope)
_result = _df.groupby(_groups + [_category], dropna=False, observed=True)[_measure].sum().reset_index()
assert math.isclose(float(_result[_measure].sum()), float(_df[_measure].sum()), rel_tol=1e-9, abs_tol=1e-6), 'Aggregated total differs from filtered source total.'
if _p['output'] == 'winners':
    _maximum = _result.groupby(_groups, dropna=False)[_measure].transform('max')
    _result = _result[_result[_measure] == _maximum]
    assert len(_result[_groups].drop_duplicates()) == _count, 'Winner coverage mismatch.'
else:
    _categories = list(_df[_category].unique())
    _index = pd.MultiIndex.from_tuples([tuple(g) + (c,) for g in _df[_groups].drop_duplicates().itertuples(index=False, name=None) for c in _categories], names=_groups + [_category])
    _result = _result.set_index(_groups + [_category]).reindex(_index, fill_value=0).reset_index()
if _p['output'] == 'stacked-bar':
    import matplotlib.pyplot as plt
    _matrix = _result.pivot(index=_groups[0], columns=_category, values=_measure).fillna(0).sort_index()
    assert set(_matrix.columns) == set(_df[_category]), 'Chart category coverage mismatch.'
    assert math.isclose(float(_matrix.to_numpy().sum()), float(_df[_measure].sum()), rel_tol=1e-9, abs_tol=1e-6), 'Chart total mismatch.'
    _matrix.plot.bar(stacked=True, figsize=(12, 6))
    plt.ylabel(_p['units'])
    plt.tight_layout()
    plt.show()
larkup_table('Verified aggregation', _result, columns=list(_result.columns), summary='Sum in ' + _p['units'] + '; filtered source rows: ' + str(len(_df)) + '; groups: ' + str(_count) + '; missing category/group values retained; ties preserved.')
`;
}
