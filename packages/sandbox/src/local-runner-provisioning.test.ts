import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const childProcess = vi.hoisted(() => ({ spawn: vi.fn() }));

vi.mock('node:child_process', () => childProcess);

import { executeLocally, setupLocalRuntime } from './local-runner.js';

type SpawnCall = {
  executable: string;
  args: string[];
  options?: { env?: NodeJS.ProcessEnv };
};

const originalRuntimeDirectory = process.env.LARKUP_SANDBOX_RUNTIME_DIR;
let runtimeDirectory: string | undefined;

function successfulChild(stdout = '', stderr = '', exitCode = 0) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: () => void;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  queueMicrotask(() => {
    if (stdout) child.stdout.emit('data', Buffer.from(stdout));
    if (stderr) child.stderr.emit('data', Buffer.from(stderr));
    child.emit('close', exitCode);
  });
  return child;
}

afterEach(async () => {
  childProcess.spawn.mockReset();
  if (runtimeDirectory) await rm(runtimeDirectory, { recursive: true, force: true });
  runtimeDirectory = undefined;
  if (originalRuntimeDirectory === undefined) delete process.env.LARKUP_SANDBOX_RUNTIME_DIR;
  else process.env.LARKUP_SANDBOX_RUNTIME_DIR = originalRuntimeDirectory;
});

describe('managed local Python runtime', () => {
  it('installs analysis packages in Larkup’s virtual environment before running Python', async () => {
    runtimeDirectory = await mkdtemp(path.join(os.tmpdir(), 'larkup-sandbox-runtime-'));
    process.env.LARKUP_SANDBOX_RUNTIME_DIR = runtimeDirectory;
    const calls: SpawnCall[] = [];
    let dependencyChecks = 0;

    childProcess.spawn.mockImplementation(
      (executable: string, args: string[], options?: SpawnCall['options']) => {
        calls.push({ executable, args, options });
        if (args[0] === '-c' && args[1]?.includes('import importlib.util')) {
          dependencyChecks += 1;
          return successfulChild(
            dependencyChecks === 1 ? 'seaborn\n' : '',
            '',
            dependencyChecks === 1 ? 1 : 0,
          );
        }
        if (args[0] === '-m' && args[1] === 'pip') return successfulChild();
        if (args.length === 1 && args[0]?.endsWith('run.py'))
          return successfulChild('analysis complete\n');
        return successfulChild('Python 3.12.0\n');
      },
    );

    await setupLocalRuntime();
    const result = await executeLocally({ language: 'python', code: "print('analysis complete')" });

    const pipCall = calls.find((call) => call.args[0] === '-m' && call.args[1] === 'pip');
    expect(pipCall?.executable).toBe(
      path.join(
        runtimeDirectory,
        process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
      ),
    );
    expect(pipCall?.args).toEqual(
      expect.arrayContaining([
        'numpy==1.26.4',
        'pandas==2.2.3',
        'openpyxl==3.1.5',
        'pypdf==5.1.0',
        'seaborn==0.13.2',
      ]),
    );
    const executionCall = calls.find((call) => call.args[0]?.endsWith('run.py'));
    expect(executionCall?.executable).toBe(pipCall?.executable);
    expect(executionCall?.options?.env?.PYTHONNOUSERSITE).toBe('1');
    expect(result).toMatchObject({ exitCode: 0, stdout: 'analysis complete\n' });
  });
});
