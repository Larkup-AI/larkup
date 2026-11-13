import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { pythonExecutionSource } from './python-execution.js';

function run(code: string) {
  return execFileSync(
    'python3',
    ['-c', pythonExecutionSource(JSON.stringify(Buffer.from(code).toString('base64')))],
    { encoding: 'utf8' },
  ).trim();
}
describe('Python expression capture', () => {
  it('captures computed tuples and method calls without guessing their syntax', () => {
    expect(
      run(
        "values = [3, 7]\nsum(values) / 2, len(values), 'output' in {'output': True}, values.copy()",
      ),
    ).toBe('(5.0, 2, True, [3, 7])');
  });
  it('preserves explicit prints without duplicating None or module docstrings', () => {
    expect(run('"A module docstring"\nprint("ready")')).toBe('ready');
  });
  it('uses the research formatter when one is supplied', () => {
    expect(run('def _larkup_print_result(value):\n    print("result:", value)\n1 + 2')).toBe(
      'result: 3',
    );
  });
});

it('turns a final dataframe result into a structured answer when the host formatter exists', () => {
  const result = run(`class Frame:
    columns = ['value']
    def to_dict(self, **kwargs):
        return [{'value': 7}]
    def to_string(self, **kwargs):
        return 'value: 7'
def larkup_table(title, rows, columns=None):
    print('STRUCTURED', title, columns, rows.to_dict())
frame = Frame()
frame
`);
  expect(result).toContain("STRUCTURED Analysis results ['value'] [{'value': 7}]");
});
