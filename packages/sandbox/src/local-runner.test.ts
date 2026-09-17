import { describe, expect, it } from 'vitest';
import { buildPythonExecutionWrapper, checkLocalRuntime, executeLocally } from './local-runner.js';

describe('executeLocally', () => {
  it('uses a Python 3.9-compatible traceback signature in the generated wrapper', () => {
    const wrapper = buildPythonExecutionWrapper('raise ValueError()', '/tmp/output');

    expect(wrapper).toContain(
      'traceback.print_exception(type(error), error, error.__traceback__, file=sys.stderr)',
    );
    expect(wrapper).toContain("_larkup_prepare_cache('MPLCONFIGDIR'");
    expect(wrapper).toContain("_larkup_prepare_cache('XDG_CACHE_HOME'");
    expect(wrapper).toContain("logging.getLogger('matplotlib').setLevel(logging.ERROR)");
    expect(wrapper).toContain('Analysis result preview');
  });

  it('emits a small final dataframe preview when analysis code has no stdout', async () => {
    const result = await executeLocally({
      language: 'python',
      code: `
import pandas as pd
summary = pd.DataFrame({'Region': ['East', 'West'], 'Profit': [12.5, 18.25]})
`,
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain('Analysis result preview (summary):');
    expect(result.stdout).toContain('East');
  }, 15_000);

  it('runs JavaScript without Docker and returns output artifacts', async () => {
    const result = await executeLocally({
      language: 'javascript',
      code: `
        const fs = require('node:fs/promises');
        void (async () => {
          await fs.writeFile(process.env.LARKUP_OUTPUT_DIR + '/result.txt', 'done');
          console.log('local runtime');
        })();
      `,
    });

    expect(result).toMatchObject({ exitCode: 0, stdout: expect.stringContaining('local runtime') });
    expect(result.artifacts).toEqual([
      expect.objectContaining({ name: 'result.txt', mimeType: 'text/plain' }),
    ]);
  });

  it('accepts a Python installation that can bootstrap the managed analysis environment', async () => {
    const health = await checkLocalRuntime();
    expect(health.backend).toBe('local');
    if (health.status === 'ready') {
      expect(health.error).toBeUndefined();
    } else {
      expect(health.error).toMatch(/Python|virtual-environment/i);
    }
  });
});
