/**
 * Shared execution plumbing for every cloud sandbox adapter (E2B, Vercel
 * Sandbox, Modal, Daytona, Fly Sprites, Northflank).
 *
 * Each of those providers exposes the same primitive — "run this shell
 * command inside my sandbox and give me stdout/stderr/exitCode back" — but
 * with a different SDK shape (commands.run, runCommand, exec, ...). Rather
 * than re-implement file staging + artifact capture per provider, adapters
 * plug their SDK's exec call in as a `RemoteExecFn` and hand it to
 * `runScriptedExecution`, which builds one POSIX shell script that writes
 * any input files, runs the code, and reports back any files written to an
 * output directory (mirroring what the Docker adapter gets for free via a
 * bind mount).
 */

import type { ExecutionArtifact, ExecutionRequest, ExecutionResult } from './types.js';
import { getMimeType } from './mime.js';

/** Default per-execution timeout for remote adapters when a request doesn't specify one. */
export const DEFAULT_TIMEOUT_MS = 30_000;

const WORKDIR = '/tmp/larkup-sandbox';
const OUTPUT_DIR = `${WORKDIR}/output`;
const ARTIFACT_MARKER = '__LARKUP_ARTIFACTS__:';
/** Not part of the base64 alphabet, so it can never collide with an encoded file body. */
const HEREDOC_DELIMITER = 'LARKUP__EOF__';

export interface RemoteCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Runs a single shell command/script inside a provider's sandbox instance. */
export type RemoteExecFn = (script: string) => Promise<RemoteCommandResult>;

function assertSafeFileName(name: string): void {
  if (
    !name ||
    name === '.' ||
    name === '..' ||
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('\0')
  ) {
    throw new Error('Sandbox file names must be plain file names.');
  }
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function writeBase64FileScript(name: string, base64: string): string {
  return `base64 -d > ${shellSingleQuote(
    name,
  )} <<'${HEREDOC_DELIMITER}'\n${base64}\n${HEREDOC_DELIMITER}`;
}

/** Builds the POSIX shell script a remote adapter hands to its provider's exec call. */
export function buildExecutionScript(request: ExecutionRequest): string {
  const lines: string[] = [
    'set -e',
    `mkdir -p ${shellSingleQuote(OUTPUT_DIR)}`,
    `cd ${shellSingleQuote(WORKDIR)}`,
  ];

  for (const file of request.files ?? []) {
    assertSafeFileName(file.name);
    const base64 = file.isBase64
      ? file.content
      : Buffer.from(file.content, 'utf8').toString('base64');
    lines.push(writeBase64FileScript(file.name, base64));
  }

  const scriptName = request.language === 'python' ? 'run.py' : 'run.js';
  const runner = request.language === 'python' ? 'python3' : 'node';
  const codeBase64 = Buffer.from(request.code, 'utf8').toString('base64');
  lines.push(writeBase64FileScript(scriptName, codeBase64));
  lines.push(`${runner} ${shellSingleQuote(scriptName)}`);
  lines.push(
    `if [ -d ${shellSingleQuote(
      OUTPUT_DIR,
    )} ]; then echo "${ARTIFACT_MARKER}$(ls -1 ${shellSingleQuote(
      OUTPUT_DIR,
    )} 2>/dev/null | tr '\\n' ',')"; fi`,
  );

  return lines.join('\n');
}

function extractArtifactMarker(stdout: string): { stdout: string; artifactNames: string[] } {
  const markerIndex = stdout.lastIndexOf(ARTIFACT_MARKER);
  if (markerIndex === -1) return { stdout, artifactNames: [] };

  const before = stdout.slice(0, markerIndex);
  const after = stdout.slice(markerIndex + ARTIFACT_MARKER.length);
  const newlineIndex = after.indexOf('\n');
  const namesPart = newlineIndex === -1 ? after : after.slice(0, newlineIndex);
  const rest = newlineIndex === -1 ? '' : after.slice(newlineIndex + 1);

  const artifactNames = namesPart
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);

  return { stdout: (before + rest).replace(/\n$/, ''), artifactNames };
}

/**
 * Runs `request` via `execFn` and reassembles an `ExecutionResult`,
 * including a best-effort fetch of any files the code wrote to the output
 * directory (one follow-up `base64 <file>` call per artifact).
 */
export async function runScriptedExecution(
  execFn: RemoteExecFn,
  request: ExecutionRequest,
): Promise<ExecutionResult> {
  const startTime = Date.now();
  const script = buildExecutionScript(request);
  const main = await execFn(script);

  const { stdout, artifactNames } = extractArtifactMarker(main.stdout);
  const artifacts: ExecutionArtifact[] = [];
  for (const name of artifactNames) {
    if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..')
      continue;
    try {
      const cat = await execFn(`base64 ${shellSingleQuote(`${OUTPUT_DIR}/${name}`)}`);
      const data = cat.stdout.replace(/\s+/g, '');
      if (cat.exitCode === 0 && data) {
        artifacts.push({ name, mimeType: getMimeType(name), data });
      }
    } catch {
      /* one missing/unreadable artifact shouldn't fail the whole execution */
    }
  }

  return {
    stdout,
    stderr: main.stderr,
    exitCode: main.exitCode,
    artifacts,
    executionTimeMs: Date.now() - startTime,
  };
}

/** Uniform safety net for providers whose SDK doesn't take its own per-call timeout. */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * Runs a teardown call (kill/delete/terminate/stop) and swallows whatever it
 * throws or rejects with — cleanup failures shouldn't mask the actual
 * execution result. Wrapping in try/catch (rather than `.catch()`) also
 * tolerates a teardown method that doesn't return a real promise.
 */
export async function safeCleanup(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch {
    /* best effort */
  }
}

export function failedResult(message: string, startTime: number): ExecutionResult {
  return {
    stdout: '',
    stderr: message,
    exitCode: 1,
    artifacts: [],
    executionTimeMs: Date.now() - startTime,
  };
}
