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

describe('escaped code transport', () => {
  it('repairs separators outside literals while preserving strings and regex escapes', () => {
    expect(
      run(
        String.raw`import re\nvalue = "a\nb"\nprint(value.split("\n"))\nprint(bool(re.match(r"\d+", "12")))`,
      ),
    ).toBe("['a', 'b']\nTrue");
  });
  it('leaves valid source and triple-quoted literals unchanged', () => {
    expect(run('text = """literal \\\\n marker"""\nprint(repr(text))')).toBe(
      "'literal \\\\n marker'",
    );
  });
  it('does not execute a valid prefix when a later statement fails parsing', () => {
    expect(() => run(String.raw`print("must not execute")\nif :`)).toThrow();
  });
});
