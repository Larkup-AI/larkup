/**
 * E2B adapter — https://docs.e2b.dev/
 *
 * Uses the base `e2b` SDK (not `@e2b/code-interpreter`) so execution stays a
 * plain "run this shell script, get stdout/stderr/exitCode" call, matching
 * every other remote adapter and letting them share `runScriptedExecution`.
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

interface E2bSandbox {
  commands: {
    run(
      script: string,
      opts?: { timeoutMs?: number },
    ): Promise<{ stdout?: string; stderr?: string; exitCode?: number }>;
  };
  kill(): Promise<void>;
}

interface E2bModule {
  Sandbox: {
    create(
      template: string,
      opts: { apiKey: string; timeoutMs?: number; allowInternetAccess?: boolean },
    ): Promise<E2bSandbox>;
    create(opts: {
      apiKey: string;
      timeoutMs?: number;
      allowInternetAccess?: boolean;
    }): Promise<E2bSandbox>;
    list(opts: { apiKey: string }): { nextItems(): Promise<unknown[]> };
  };
}

async function loadSdk(): Promise<E2bModule> {
  return (await import('e2b')) as unknown as E2bModule;
}

async function verifyCredentials(credentials: Record<string, string>): Promise<void> {
  const apiKey = credentials.apiKey?.trim();
  if (!apiKey) throw new Error('E2B API key is required.');
  const { Sandbox } = await loadSdk();
  await Sandbox.list({ apiKey }).nextItems();
}

async function healthCheck(credentials: Record<string, string>): Promise<SandboxHealthCheck> {
  if (!credentials.apiKey?.trim()) {
    return { status: 'missing-credentials', backend: 'e2b', error: 'E2B API key is required.' };
  }
  try {
    await verifyCredentials(credentials);
    return { status: 'ready', backend: 'e2b' };
  } catch (err) {
    return {
      status: 'error',
      backend: 'e2b',
      error: err instanceof Error ? err.message : 'E2B health check failed.',
    };
  }
}

async function execute(
  request: ExecutionRequest,
  credentials: Record<string, string>,
): Promise<ExecutionResult> {
  const startTime = Date.now();
  const apiKey = credentials.apiKey?.trim();
  if (!apiKey) return failedResult('E2B API key is required.', startTime);

  const timeoutMs = request.timeout ?? DEFAULT_TIMEOUT_MS;
  let sandbox: E2bSandbox | undefined;
  try {
    const { Sandbox } = await loadSdk();
    const options = { apiKey, timeoutMs: timeoutMs + 60_000, allowInternetAccess: false };
    const snapshotId = credentials.snapshotId?.trim();
    sandbox = await withTimeout(
      snapshotId ? Sandbox.create(snapshotId, options) : Sandbox.create(options),
      timeoutMs + 30_000,
      'E2B sandbox create',
    );
    const activeSandbox = sandbox;
    return await runScriptedExecution(async (script) => {
      const result = await activeSandbox.commands.run(script, { timeoutMs });
      return {
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        exitCode: result.exitCode ?? 0,
      };
    }, request);
  } catch (err) {
    return failedResult(err instanceof Error ? err.message : 'E2B execution failed.', startTime);
  } finally {
    if (sandbox) await safeCleanup(() => sandbox!.kill());
  }
}

export const e2bAdapter: SandboxProviderAdapter = {
  id: 'e2b',
  verifyCredentials,
  healthCheck,
  execute,
};
