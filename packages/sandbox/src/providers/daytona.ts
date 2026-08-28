/**
 * Daytona adapter — https://www.daytona.io/docs/en/sandboxes/
 *
 * Daytona's `process.executeCommand` result doesn't document a separate
 * stderr field (output comes back merged into `result`), so unlike the
 * other adapters we can't cleanly split stdout/stderr — everything lands in
 * stdout, and the combined output is mirrored into stderr only when the
 * command actually failed (exitCode !== 0), so error output still surfaces
 * where callers expect it.
 */

import type {
  SandboxHealthCheck,
  ExecutionRequest,
  ExecutionResult,
  SandboxProviderAdapter,
} from '../types.js';
import {
  DEFAULT_TIMEOUT_MS,
  failedResult,
  runScriptedExecution,
  safeCleanup,
  withTimeout,
} from '../remote-exec.js';

interface DaytonaSandbox {
  process: {
    executeCommand(
      command: string,
      cwd?: string,
      env?: Record<string, string>,
      timeout?: number,
    ): Promise<{
      exitCode?: number;
      result?: string;
    }>;
  };
  delete(): Promise<void>;
}

interface DaytonaClient {
  create(opts?: Record<string, unknown>): Promise<DaytonaSandbox>;
  list(): AsyncIterator<unknown>;
}

interface DaytonaModule {
  Daytona: new (opts: { apiKey: string; apiUrl?: string }) => DaytonaClient;
}

async function loadSdk(): Promise<DaytonaModule> {
  return (await import('@daytonaio/sdk')) as unknown as DaytonaModule;
}

function requireFields(credentials: Record<string, string>): { apiKey: string; apiUrl?: string } {
  const apiKey = credentials.apiKey?.trim();
  if (!apiKey) throw new Error('Daytona API key is required.');
  return { apiKey, apiUrl: credentials.apiUrl?.trim() || undefined };
}

async function verifyCredentials(credentials: Record<string, string>): Promise<void> {
  const fields = requireFields(credentials);
  const { Daytona } = await loadSdk();
  const daytona = new Daytona(fields);
  await daytona.list().next();
}

async function healthCheck(credentials: Record<string, string>): Promise<SandboxHealthCheck> {
  if (!credentials.apiKey?.trim()) {
    return {
      status: 'missing-credentials',
      backend: 'daytona',
      error: 'Daytona API key is required.',
    };
  }
  try {
    await verifyCredentials(credentials);
    return { status: 'ready', backend: 'daytona' };
  } catch (err) {
    return {
      status: 'error',
      backend: 'daytona',
      error: err instanceof Error ? err.message : 'Daytona health check failed.',
    };
  }
}

async function execute(
  request: ExecutionRequest,
  credentials: Record<string, string>,
): Promise<ExecutionResult> {
  const startTime = Date.now();
  let fields: { apiKey: string; apiUrl?: string };
  try {
    fields = requireFields(credentials);
  } catch (err) {
    return failedResult(
      err instanceof Error ? err.message : 'Missing Daytona credentials.',
      startTime,
    );
  }

  const timeoutMs = request.timeout ?? DEFAULT_TIMEOUT_MS;
  let sandbox: DaytonaSandbox | undefined;
  try {
    const { Daytona } = await loadSdk();
    const daytona = new Daytona(fields);
    const snapshot = credentials.snapshot?.trim();
    sandbox = await withTimeout(
      daytona.create(snapshot ? { snapshot } : { language: 'python' }),
      timeoutMs + 30_000,
      'Daytona sandbox create',
    );
    const activeSandbox = sandbox;
    return await withTimeout(
      runScriptedExecution(async (script) => {
        const result = await activeSandbox.process.executeCommand(
          script,
          undefined,
          undefined,
          timeoutMs / 1000,
        );
        const exitCode = result.exitCode ?? 0;
        const output = result.result ?? '';
        return { stdout: output, stderr: exitCode !== 0 ? output : '', exitCode };
      }, request),
      timeoutMs + 15_000,
      'Daytona execution',
    );
  } catch (err) {
    return failedResult(
      err instanceof Error ? err.message : 'Daytona execution failed.',
      startTime,
    );
  } finally {
    if (sandbox) await safeCleanup(() => sandbox!.delete());
  }
}

export const daytonaAdapter: SandboxProviderAdapter = {
  id: 'daytona',
  verifyCredentials,
  healthCheck,
  execute,
};
