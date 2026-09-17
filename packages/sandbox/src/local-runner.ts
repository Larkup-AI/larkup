import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { EventEmitter } from 'node:events';
import type {
  ExecutionArtifact,
  ExecutionRequest,
  ExecutionResult,
  SandboxHealthCheck,
} from './types.js';
import { getMimeType } from './mime.js';

type Command = { executable: string; args: string[] };

let pythonCommand: Command | null | undefined;
let managedPythonCommand: Promise<Command> | undefined;

// Keep this list in sync with the capabilities advertised by executeAnalysis
// and analyzeCorpusWithCode. These packages are installed in Larkup's managed
// virtual environment, never into the Python installation on the host.
const ANALYSIS_PYTHON_MODULES = [
  'numpy',
  'pandas',
  'matplotlib',
  'scipy',
  'sklearn',
  'seaborn',
  'openpyxl',
  'xlrd',
  'pypdf',
  'docx',
  'pptx',
  'PIL',
];
const ANALYSIS_PYTHON_PACKAGES = [
  'pandas==2.2.3',
  // Python 3.9 ships with several supported desktop environments. Keep the
  // local pins compatible with it rather than requiring a user-managed upgrade.
  'numpy==1.26.4',
  'matplotlib==3.9.4',
  'openpyxl==3.1.5',
  'scipy==1.13.1',
  'scikit-learn==1.6.1',
  'seaborn==0.13.2',
  'xlrd==2.0.1',
  'pypdf==5.1.0',
  'python-docx==1.1.2',
  'python-pptx==1.0.2',
  'Pillow==11.1.0',
];

function pythonEnvironment(virtualEnv?: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // Let neither a user's active virtual environment nor PYTHONPATH leak into
  // the managed runtime. This preserves the repeatable dependency set.
  delete env.PYTHONHOME;
  delete env.PYTHONPATH;
  delete env.VIRTUAL_ENV;
  if (virtualEnv) {
    env.VIRTUAL_ENV = virtualEnv;
    env.PYTHONNOUSERSITE = '1';
    env.PATH = `${path.dirname(virtualEnvPython(virtualEnv))}${path.delimiter}${env.PATH ?? ''}`;
    // Persist Matplotlib and font caches with the managed runtime rather than
    // recreating them in a disposable execution directory on every chart.
    const cacheDirectory = path.join(virtualEnv, 'cache');
    env.MPLCONFIGDIR = path.join(cacheDirectory, 'matplotlib');
    env.XDG_CACHE_HOME = cacheDirectory;
  }
  return env;
}

function run(
  command: Command,
  args: string[],
  cwd?: string,
  timeoutMs = 10_000,
  env: NodeJS.ProcessEnv = process.env,
) {
  return new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve, reject) => {
    const child = spawn(command.executable, [...command.args, ...args], {
      cwd,
      env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // Node ChildProcess is an EventEmitter at runtime. TypeScript 7's narrowed stdio return type
    // omits that inherited surface, so retain it explicitly for lifecycle events.
    const lifecycle = child as unknown as EventEmitter;
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout = (stdout + chunk).slice(-1_000_000);
    });
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-1_000_000);
    });
    lifecycle.once('error', (error: Error) => {
      clearTimeout(timer);
      reject(error);
    });
    lifecycle.once('close', (code: number | null) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr: timedOut ? `${stderr}\nExecution timed out.`.trim() : stderr,
        exitCode: timedOut ? 124 : (code ?? 1),
      });
    });
  });
}

async function resolvePython(): Promise<Command | null> {
  if (pythonCommand !== undefined) return pythonCommand;
  const candidates: Command[] = process.env.LARKUP_PYTHON
    ? [{ executable: process.env.LARKUP_PYTHON, args: [] }]
    : process.platform === 'win32'
      ? [
          { executable: 'py', args: ['-3'] },
          { executable: 'python', args: [] },
        ]
      : [
          { executable: 'python3', args: [] },
          { executable: 'python', args: [] },
        ];

  for (const candidate of candidates) {
    try {
      if (
        (await run(candidate, ['--version'], undefined, 10_000, pythonEnvironment())).exitCode === 0
      ) {
        pythonCommand = candidate;
        return candidate;
      }
    } catch {
      continue;
    }
  }
  pythonCommand = null;
  return null;
}

function localRuntimeDirectory(): string {
  const configured = process.env.LARKUP_SANDBOX_RUNTIME_DIR?.trim();
  if (configured) return path.resolve(configured);

  const dataRoot = process.env.LARKUP_DATA_DIR?.trim();
  return path.join(
    dataRoot ? path.resolve(dataRoot) : path.join(process.cwd(), '.larkup'),
    'sandbox',
    'python',
  );
}

function virtualEnvPython(runtimeDirectory: string): string {
  return process.platform === 'win32'
    ? path.join(runtimeDirectory, 'Scripts', 'python.exe')
    : path.join(runtimeDirectory, 'bin', 'python');
}

function dependencyCheckCode(): string {
  return `import importlib.util\nmodules = ${JSON.stringify(
    ANALYSIS_PYTHON_MODULES,
  )}\nmissing = [name for name in modules if importlib.util.find_spec(name) is None]\nprint(','.join(missing))\nraise SystemExit(bool(missing))`;
}

async function hasAnalysisDependencies(
  command: Command,
  runtimeDirectory: string,
): Promise<boolean> {
  try {
    return (
      (
        await run(
          command,
          ['-c', dependencyCheckCode()],
          undefined,
          30_000,
          pythonEnvironment(runtimeDirectory),
        )
      ).exitCode === 0
    );
  } catch {
    return false;
  }
}

async function prepareManagedPythonRuntime(): Promise<Command> {
  const bootstrapPython = await resolvePython();
  if (!bootstrapPython) {
    throw new Error(
      'Local code execution needs Python 3.9 or later, or choose Docker or a remote sandbox provider.',
    );
  }

  const runtimeDirectory = localRuntimeDirectory();
  const managedPython: Command = { executable: virtualEnvPython(runtimeDirectory), args: [] };
  const bootstrapCheck = await run(
    bootstrapPython,
    ['-c', 'import sys, venv; raise SystemExit(sys.version_info < (3, 9))'],
    undefined,
    10_000,
    pythonEnvironment(),
  );
  if (bootstrapCheck.exitCode !== 0) {
    throw new Error(
      'Local code execution needs Python 3.9 or later with virtual-environment support. Install Python or choose Docker or a remote sandbox provider.',
    );
  }

  const runtimeExists = await fs.access(managedPython.executable).then(
    () => true,
    () => false,
  );
  if (!runtimeExists) {
    await fs.mkdir(path.dirname(runtimeDirectory), { recursive: true });
    const created = await run(
      bootstrapPython,
      ['-m', 'venv', runtimeDirectory],
      undefined,
      60_000,
      pythonEnvironment(),
    );
    if (created.exitCode !== 0) {
      throw new Error(
        'Larkup could not create its local Python environment. Check that Python virtual environments are enabled, or choose Docker or a remote sandbox provider.',
      );
    }
  }

  if (await hasAnalysisDependencies(managedPython, runtimeDirectory)) return managedPython;

  const installed = await run(
    managedPython,
    [
      '-m',
      'pip',
      'install',
      '--disable-pip-version-check',
      '--no-input',
      ...ANALYSIS_PYTHON_PACKAGES,
    ],
    undefined,
    10 * 60_000,
    pythonEnvironment(runtimeDirectory),
  );
  if (
    installed.exitCode !== 0 ||
    !(await hasAnalysisDependencies(managedPython, runtimeDirectory))
  ) {
    throw new Error(
      'Larkup could not prepare its local analysis environment. Check the internet connection and retry, or choose Docker or a remote sandbox provider.',
    );
  }
  return managedPython;
}

/** Creates or repairs Larkup's isolated local Python analysis environment. */
export async function setupLocalRuntime(): Promise<void> {
  if (!managedPythonCommand) {
    managedPythonCommand = prepareManagedPythonRuntime().catch((error) => {
      managedPythonCommand = undefined;
      throw error;
    });
  }
  await managedPythonCommand;
}

async function getManagedPython(): Promise<Command> {
  await setupLocalRuntime();
  // setupLocalRuntime only resolves after prepareManagedPythonRuntime resolves.
  return managedPythonCommand!;
}

function assertSafeFileName(name: string) {
  if (!name || name === '.' || name === '..' || /[\\/\0]/.test(name)) {
    throw new Error('Sandbox file names must be plain file names.');
  }
}

/** Build a Python wrapper that saves charts and preserves the original traceback on Python 3.9+. */
export function buildPythonExecutionWrapper(code: string, outputDir: string) {
  return `import base64, logging, os, sys, traceback
from contextlib import redirect_stdout
from io import StringIO
os.makedirs(${JSON.stringify(outputDir)}, exist_ok=True)
os.environ.setdefault('MPLBACKEND', 'Agg')
def _larkup_prepare_cache(name, fallback):
    value = os.environ.get(name) or fallback
    try:
        os.makedirs(value, exist_ok=True)
    except OSError:
        value = fallback
        os.makedirs(value, exist_ok=True)
    os.environ[name] = value
_larkup_prepare_cache('MPLCONFIGDIR', os.path.join(${JSON.stringify(outputDir)}, '.matplotlib'))
_larkup_prepare_cache('XDG_CACHE_HOME', os.path.join(${JSON.stringify(outputDir)}, '.cache'))
logging.getLogger('matplotlib').setLevel(logging.ERROR)
try:
    import numpy as np
    import pandas as pd
except ImportError:
    pass
try:
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    def _save_figures(*args, **kwargs):
        for i, number in enumerate(plt.get_fignums()):
            plt.figure(number).savefig(os.path.join(${JSON.stringify(
              outputDir,
            )}, f'chart_{i}.png'), dpi=150, bbox_inches='tight')
        plt.close('all')
    plt.show = _save_figures
except ImportError:
    pass
try:
    _larkup_stdout = StringIO()
    with redirect_stdout(_larkup_stdout):
        exec(compile(base64.b64decode(${JSON.stringify(
          Buffer.from(code).toString('base64'),
        )}), 'analysis.py', 'exec'))
    _larkup_output = _larkup_stdout.getvalue()
    sys.stdout.write(_larkup_output)
    if not _larkup_output.strip():
        for _larkup_name, _larkup_value in reversed(list(globals().items())):
            if _larkup_name.startswith('_'):
                continue
            try:
                _larkup_length = len(_larkup_value)
                _larkup_to_string = getattr(_larkup_value, 'to_string', None)
                if not callable(_larkup_to_string) or not 0 < _larkup_length <= 50:
                    continue
                try:
                    _larkup_preview = _larkup_to_string(index=False)
                except TypeError:
                    _larkup_preview = _larkup_to_string()
                print(f'Analysis result preview ({_larkup_name}):\\n{str(_larkup_preview)[:4000]}')
                break
            except Exception:
                continue
    if 'plt' in globals() and plt.get_fignums():
        plt.show()
except Exception as error:
    traceback.print_exception(type(error), error, error.__traceback__, file=sys.stderr)
    sys.exit(1)
`;
}

/** Checks whether the host can bootstrap Larkup's managed Python environment. */
export async function checkLocalRuntime(): Promise<SandboxHealthCheck> {
  const python = await resolvePython();
  if (!python) {
    return {
      status: 'error',
      backend: 'local',
      error:
        'Local code execution needs Python 3. Install Python or choose Docker or a remote sandbox provider.',
    };
  }

  try {
    const bootstrapCheck = await run(
      python,
      ['-c', 'import sys, venv; raise SystemExit(sys.version_info < (3, 9))'],
      undefined,
      10_000,
      pythonEnvironment(),
    );
    if (bootstrapCheck.exitCode !== 0) {
      return {
        status: 'error',
        backend: 'local',
        error:
          'Local code execution needs Python 3.9 or later with virtual-environment support. Install Python or choose Docker or a remote sandbox provider.',
      };
    }
  } catch {
    return {
      status: 'error',
      backend: 'local',
      error:
        'Larkup could not verify Python virtual-environment support. Choose Docker or a remote sandbox provider.',
    };
  }
  return { status: 'ready', backend: 'local' };
}

/** Executes trusted code in a temporary host workspace and collects its output. */
export async function executeLocally(request: ExecutionRequest): Promise<ExecutionResult> {
  const startTime = Date.now();
  const tempDir = path.join(os.tmpdir(), `larkup-local-${randomUUID()}`);
  const inputDir = path.join(tempDir, 'input');
  const outputDir = path.join(tempDir, 'output');
  try {
    await fs.mkdir(inputDir, { recursive: true });
    await fs.mkdir(outputDir, { recursive: true });
    for (const file of request.files ?? []) {
      assertSafeFileName(file.name);
      await fs.writeFile(
        path.join(inputDir, file.name),
        file.isBase64 ? Buffer.from(file.content, 'base64') : file.content,
      );
    }

    const isPython = request.language === 'python';
    const command = isPython
      ? await getManagedPython()
      : { executable: process.execPath, args: [] };

    const script = path.join(tempDir, isPython ? 'run.py' : 'run.js');
    const source = isPython
      ? buildPythonExecutionWrapper(request.code, outputDir)
      : `process.env.LARKUP_OUTPUT_DIR = ${JSON.stringify(outputDir)};\n${request.code}`;
    await fs.writeFile(script, source, 'utf8');
    const result = await run(
      command,
      [script],
      inputDir,
      request.timeout ?? 30_000,
      isPython ? pythonEnvironment(localRuntimeDirectory()) : process.env,
    );
    const artifacts: ExecutionArtifact[] = [];
    for (const name of await fs.readdir(outputDir).catch(() => [])) {
      const filePath = path.join(outputDir, name);
      const stat = await fs.stat(filePath).catch(() => null);
      if (!stat?.isFile()) continue;
      artifacts.push({
        name,
        mimeType: getMimeType(name),
        data: (await fs.readFile(filePath)).toString('base64'),
      });
    }
    return { ...result, artifacts, executionTimeMs: Date.now() - startTime };
  } catch (error) {
    return {
      stdout: '',
      stderr: error instanceof Error ? error.message : 'Local execution failed.',
      exitCode: 1,
      artifacts: [],
      executionTimeMs: Date.now() - startTime,
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
