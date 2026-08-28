import { describe, expect, it, vi } from 'vitest';
import { buildExecutionScript, failedResult, runScriptedExecution, withTimeout } from './remote-exec.js';
import type { ExecutionRequest } from './types.js';

describe('buildExecutionScript', () => {
  it('writes the code to run.py and invokes python3 for python requests', () => {
    const request: ExecutionRequest = { code: 'print(1)', language: 'python' };
    const script = buildExecutionScript(request);
    expect(script).toContain("mkdir -p '/tmp/larkup-sandbox/output'");
    expect(script).toContain("base64 -d > 'run.py'");
    expect(script).toContain("python3 'run.py'");
    expect(script).not.toContain("node 'run.js'");
  });

  it('writes the code to run.js and invokes node for non-python requests', () => {
    const request: ExecutionRequest = { code: 'console.log(1)', language: 'javascript' };
    const script = buildExecutionScript(request);
    expect(script).toContain("base64 -d > 'run.js'");
    expect(script).toContain("node 'run.js'");
  });

  it('base64-encodes and stages every input file before running the code', () => {
    const request: ExecutionRequest = {
      code: 'x=1',
      language: 'python',
      files: [{ name: 'data.csv', content: 'a,b\n1,2' }],
    };
    const script = buildExecutionScript(request);
    const expectedBase64 = Buffer.from('a,b\n1,2', 'utf8').toString('base64');
    expect(script).toContain("base64 -d > 'data.csv'");
    expect(script).toContain(expectedBase64);
    // File staging must happen before the code executes.
    expect(script.indexOf("'data.csv'")).toBeLessThan(script.indexOf("'run.py'"));
  });

  it('passes already-base64 file content through unmodified', () => {
    const b64 = Buffer.from('binary-ish').toString('base64');
    const request: ExecutionRequest = {
      code: 'x=1',
      language: 'python',
      files: [{ name: 'blob.bin', content: b64, isBase64: true }],
    };
    const script = buildExecutionScript(request);
    expect(script).toContain(b64);
  });

  it('single-quotes filenames so shell metacharacters cannot break out', () => {
    const request: ExecutionRequest = {
      code: 'x=1',
      language: 'python',
      files: [{ name: "weird'name.csv", content: 'a' }],
    };
    const script = buildExecutionScript(request);
    expect(script).toContain(String.raw`'weird'\''name.csv'`);
  });

  it('rejects path-like input file names', () => {
    expect(() =>
      buildExecutionScript({
        code: 'x=1',
        language: 'python',
        files: [{ name: '../escape.py', content: 'x' }],
      }),
    ).toThrow('Sandbox file names must be plain file names.');
  });

  it('emits an artifact marker line that lists the output directory', () => {
    const script = buildExecutionScript({ code: 'x=1', language: 'python' });
    expect(script).toContain('__LARKUP_ARTIFACTS__:');
    expect(script).toContain("ls -1 '/tmp/larkup-sandbox/output'");
  });
});

describe('runScriptedExecution', () => {
  it('passes stdout/stderr/exitCode straight through when there are no artifacts', async () => {
    const execFn = vi.fn().mockResolvedValue({ stdout: 'hello\n', stderr: '', exitCode: 0 });
    const result = await runScriptedExecution(execFn, { code: 'print(1)', language: 'python' });

    expect(execFn).toHaveBeenCalledTimes(1);
    expect(result.stdout).toBe('hello\n');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
    expect(result.artifacts).toEqual([]);
    expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('strips the artifact marker from stdout and fetches each named artifact', async () => {
    const chartBase64 = Buffer.from('fake-png-bytes').toString('base64');
    const execFn = vi
      .fn()
      .mockResolvedValueOnce({
        stdout: 'analysis done\n__LARKUP_ARTIFACTS__:chart_0.png,chart_1.png\n',
        stderr: '',
        exitCode: 0,
      })
      .mockResolvedValueOnce({ stdout: chartBase64, stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: chartBase64, stderr: '', exitCode: 0 });

    const result = await runScriptedExecution(execFn, { code: 'x=1', language: 'python' });

    expect(result.stdout).toBe('analysis done');
    expect(execFn).toHaveBeenCalledTimes(3);
    expect(result.artifacts).toHaveLength(2);
    expect(result.artifacts[0]).toEqual({ name: 'chart_0.png', mimeType: 'image/png', data: chartBase64 });
    expect(result.artifacts[1].name).toBe('chart_1.png');
  });

  it('drops an artifact whose follow-up fetch fails instead of failing the whole execution', async () => {
    const execFn = vi
      .fn()
      .mockResolvedValueOnce({ stdout: '__LARKUP_ARTIFACTS__:missing.png\n', stderr: '', exitCode: 0 })
      .mockRejectedValueOnce(new Error('file gone'));

    const result = await runScriptedExecution(execFn, { code: 'x=1', language: 'python' });
    expect(result.exitCode).toBe(0);
    expect(result.artifacts).toEqual([]);
  });

  it('leaves a non-zero exit code and stderr message untouched', async () => {
    const execFn = vi.fn().mockResolvedValue({ stdout: '', stderr: 'Traceback...', exitCode: 1 });
    const result = await runScriptedExecution(execFn, { code: 'raise ValueError()', language: 'python' });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('Traceback...');
  });
});

describe('withTimeout', () => {
  it('resolves with the underlying value when it settles first', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000, 'test')).resolves.toBe('ok');
  });

  it('rejects with a labeled error once the timeout elapses', async () => {
    vi.useFakeTimers();
    try {
      const never = new Promise(() => {});
      const pending = withTimeout(never, 50, 'slow op');
      const assertion = expect(pending).rejects.toThrow('slow op timed out after 50ms');
      await vi.advanceTimersByTimeAsync(60);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('failedResult', () => {
  it('produces a normalized failure shape', () => {
    const result = failedResult('boom', Date.now() - 5);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('boom');
    expect(result.artifacts).toEqual([]);
    expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
  });
});
