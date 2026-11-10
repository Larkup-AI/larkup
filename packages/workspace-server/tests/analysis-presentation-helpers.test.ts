import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { withAnalysisPresentationHelpers } from '../src/lib/chat/analysis-presentation.ts';

function hasPandas(): boolean {
  try {
    execFileSync('python3', ['-c', 'import pandas'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

test('json.dumps serializes scientific scalar values in generated analysis code', () => {
  const code = `
import json

class ScientificScalar:
    def item(self):
        return 900

print(json.dumps({"subjects": ScientificScalar()}, indent=2))
`;
  const stdout = execFileSync('python3', ['-c', withAnalysisPresentationHelpers(code)], {
    encoding: 'utf8',
  });
  assert.deepEqual(JSON.parse(stdout), { subjects: 900 });
});

test(
  'dataframe percentage columns are rendered at one-decimal precision',
  { skip: !hasPandas() && 'pandas is not installed' },
  () => {
    const code = `
import pandas as pd

result = pd.DataFrame({
    "site_name": ["Munich", "Madrid"],
    "missed_count": [13, 12],
    "missed_percentage": [5.963303, 5.333333],
})
_larkup_print_result(result)
`;
    const stdout = execFileSync('python3', ['-c', withAnalysisPresentationHelpers(code)], {
      encoding: 'utf8',
    });
    assert.match(stdout, /Munich\s+13\s+6\.0/);
    assert.match(stdout, /Madrid\s+12\s+5\.3/);
    assert.doesNotMatch(stdout, /5\.963303|5\.333333/);
  },
);

test('uses the preloaded presentation helper when generated code imports a module for it', () => {
  const stdout = execFileSync(
    'python3',
    [
      '-c',
      withAnalysisPresentationHelpers(
        "import functions\nfunctions.larkup_table('Counts', [{'group': 'A', 'count': 2}])",
      ),
    ],
    { encoding: 'utf8' },
  );
  assert.match(stdout, /__LARKUP_PRESENTATION__:/);
  assert.match(stdout, /"count": 2/);
});
