/**
 * Vercel Sandbox adapter — https://vercel.com/docs/sandbox
 *
 * Uses the access-token auth path (token + team + project) rather than the
 * OIDC path, since credentials here come from the Settings UI, not a
 * Vercel-managed environment.
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

interface VercelCommandResult {
  exitCode: number;
  stdout(): Promise<string>;
  stderr(): Promise<string>;
}

interface VercelSandbox {
  runCommand(cmd: string, args: string[]): Promise<VercelCommandResult>;
  stop(): Promise<unknown>;
}

interface VercelSandboxModule {
  Sandbox: {
    create(opts: {
      token: string;
      teamId: string;
      projectId: string;
      timeout?: number;
      source?: { type: 'snapshot'; snapshotId: string };
    }): Promise<VercelSandbox>;
    list(opts: {
      token: string;
      teamId: string;
      projectId: string;
    }): Promise<{ toArray(): Promise<unknown[]> }>;
  };
}

async function loadSdk(): Promise<VercelSandboxModule> {
  return (await import('@vercel/sandbox')) as unknown as VercelSandboxModule;
}

function requireFields(credentials: Record<string, string>): {
  token: string;
  teamId: string;
  projectId: string;
} {
  const token = credentials.token?.trim();
  const teamId = credentials.teamId?.trim();
  const projectId = credentials.projectId?.trim();
  if (!token || !teamId || !projectId) {
    throw new Error('Vercel access token, team ID, and project ID are all required.');
  }
  return { token, teamId, projectId };
}

async function verifyCredentials(credentials: Record<string, string>): Promise<void> {
  const { token, teamId, projectId } = requireFields(credentials);
  const { Sandbox } = await loadSdk();
  await (await Sandbox.list({ token, teamId, projectId })).toArray();
}

async function healthCheck(credentials: Record<string, string>): Promise<SandboxHealthCheck> {
  try {
    await verifyCredentials(credentials);
    return { status: 'ready', backend: 'vercel' };
  } catch (err) {
    const missing = !credentials.token || !credentials.teamId || !credentials.projectId;
    return {
      status: missing ? 'missing-credentials' : 'error',
      backend: 'vercel',
      error: err instanceof Error ? err.message : 'Vercel Sandbox health check failed.',
    };
  }
}

async function execute(
  request: ExecutionRequest,
  credentials: Record<string, string>,
): Promise<ExecutionResult> {
  const startTime = Date.now();
  let fields: { token: string; teamId: string; projectId: string };
  try {
    fields = requireFields(credentials);
  } catch (err) {
    return failedResult(
      err instanceof Error ? err.message : 'Missing Vercel credentials.',
      startTime,
    );
  }

  const timeoutMs = request.timeout ?? DEFAULT_TIMEOUT_MS;
  let sandbox: VercelSandbox | undefined;
  try {
    const { Sandbox } = await loadSdk();
    const snapshotId = credentials.snapshotId?.trim();
    sandbox = await withTimeout(
      Sandbox.create({
        ...fields,
        timeout: timeoutMs + 60_000,
        ...(snapshotId ? { source: { type: 'snapshot' as const, snapshotId } } : {}),
      }),
      timeoutMs + 30_000,
      'Vercel sandbox create',
    );
    const activeSandbox = sandbox;
    return await withTimeout(
      runScriptedExecution(async (script) => {
        const result = await activeSandbox.runCommand('bash', ['-c', script]);
        const [stdout, stderr] = await Promise.all([result.stdout(), result.stderr()]);
        return { stdout, stderr, exitCode: result.exitCode };
      }, request),
      timeoutMs + 15_000,
      'Vercel Sandbox execution',
    );
  } catch (err) {
    return failedResult(
      err instanceof Error ? err.message : 'Vercel Sandbox execution failed.',
      startTime,
    );
  } finally {
    if (sandbox) await safeCleanup(() => sandbox!.stop());
  }
}

export const vercelAdapter: SandboxProviderAdapter = {
  id: 'vercel',
  verifyCredentials,
  healthCheck,
  execute,
};
