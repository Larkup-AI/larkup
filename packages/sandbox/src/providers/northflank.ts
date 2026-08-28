/**
 * Northflank adapter — https://northflank.com/docs/v1/application/sandboxes/sandboxes-on-northflank
 *
 * Northflank has no dedicated "Sandbox" primitive — a sandbox here is a
 * short-lived service deployment (`sleep infinity` container) we exec
 * commands into over a session, then tear down.
 */

import { randomUUID } from 'node:crypto';
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

interface NorthflankExecHandle {
  stdOut: { on(event: 'data', cb: (chunk: Buffer | string) => void): void };
  stdErr: { on(event: 'data', cb: (chunk: Buffer | string) => void): void };
  waitForCommandResult(): Promise<{ exitCode?: number }>;
}

interface NorthflankApiClient {
  create: { service: { deployment(args: unknown): Promise<unknown> } };
  get: {
    project(args: { parameters: { projectId: string } }): Promise<unknown>;
    service(args: unknown): Promise<{ data?: { status?: string } }>;
  };
  delete: { service(args: unknown): Promise<unknown> };
  exec: {
    execServiceSession(
      target: { projectId: string; serviceId: string },
      opts: { shell: string; command: string },
    ): Promise<NorthflankExecHandle>;
  };
}

interface NorthflankModule {
  ApiClient: new (
    ctx: unknown,
    opts?: { throwErrorOnHttpErrorCode?: boolean },
  ) => NorthflankApiClient;
  ApiClientInMemoryContextProvider: new () => {
    addContext(opts: { name: string; token: string }): Promise<void>;
  };
}

async function loadSdk(): Promise<NorthflankModule> {
  return (await import('@northflank/js-client')) as unknown as NorthflankModule;
}

function requireFields(credentials: Record<string, string>): { token: string; projectId: string } {
  const token = credentials.token?.trim();
  const projectId = credentials.projectId?.trim();
  if (!token || !projectId)
    throw new Error('Northflank API token and project ID are both required.');
  return { token, projectId };
}

async function buildClient(token: string): Promise<NorthflankApiClient> {
  const { ApiClient, ApiClientInMemoryContextProvider } = await loadSdk();
  const ctx = new ApiClientInMemoryContextProvider();
  await ctx.addContext({ name: 'larkup', token });
  return new ApiClient(ctx, { throwErrorOnHttpErrorCode: true });
}

async function verifyCredentials(credentials: Record<string, string>): Promise<void> {
  const { token, projectId } = requireFields(credentials);
  const client = await buildClient(token);
  await withTimeout(
    client.get.project({ parameters: { projectId } }),
    20_000,
    'Northflank credential check',
  );
}

async function healthCheck(credentials: Record<string, string>): Promise<SandboxHealthCheck> {
  if (!credentials.token?.trim() || !credentials.projectId?.trim()) {
    return {
      status: 'missing-credentials',
      backend: 'northflank',
      error: 'Northflank API token and project ID are required.',
    };
  }
  try {
    await verifyCredentials(credentials);
    return { status: 'ready', backend: 'northflank' };
  } catch (err) {
    return {
      status: 'error',
      backend: 'northflank',
      error: err instanceof Error ? err.message : 'Northflank health check failed.',
    };
  }
}

async function waitForServiceReady(
  client: NorthflankApiClient,
  projectId: string,
  serviceId: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const service = await client.get.service({ parameters: { projectId, serviceId } });
    const status = service.data?.status;
    if (status === 'COMPLETED' || status === undefined) return; // running, or status field not modeled — proceed
    if (status === 'FAILED') throw new Error('Northflank sandbox service failed to start.');
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error('Timed out waiting for the Northflank sandbox service to become ready.');
}

async function execute(
  request: ExecutionRequest,
  credentials: Record<string, string>,
): Promise<ExecutionResult> {
  const startTime = Date.now();
  let fields: { token: string; projectId: string };
  try {
    fields = requireFields(credentials);
  } catch (err) {
    return failedResult(
      err instanceof Error ? err.message : 'Missing Northflank credentials.',
      startTime,
    );
  }

  const timeoutMs = request.timeout ?? DEFAULT_TIMEOUT_MS;
  const serviceId = `larkup-${randomUUID().slice(0, 8)}`;
  const { projectId } = fields;
  let client: NorthflankApiClient | undefined;
  try {
    client = await buildClient(fields.token);
    await withTimeout(
      client.create.service.deployment({
        parameters: { projectId },
        data: {
          name: serviceId,
          billing: { deploymentPlan: 'nf-compute-200' },
          deployment: {
            instances: 1,
            docker: { configType: 'customCommand', customCommand: 'sleep infinity' },
            external: { imagePath: 'ubuntu:22.04' },
            storage: { ephemeralStorage: { storageSize: 2048 } },
          },
        },
      }),
      30_000,
      'Northflank service create',
    );
    await waitForServiceReady(client, projectId, serviceId, 60_000);

    return await withTimeout(
      runScriptedExecution(async (script) => {
        const activeClient = client!;
        const handle = await activeClient.exec.execServiceSession(
          { projectId, serviceId },
          { shell: 'bash -c', command: script },
        );
        const stdoutChunks: string[] = [];
        const stderrChunks: string[] = [];
        handle.stdOut.on('data', (chunk) => stdoutChunks.push(chunk.toString()));
        handle.stdErr.on('data', (chunk) => stderrChunks.push(chunk.toString()));
        const result = await handle.waitForCommandResult();
        return {
          stdout: stdoutChunks.join(''),
          stderr: stderrChunks.join(''),
          exitCode: result.exitCode ?? 0,
        };
      }, request),
      timeoutMs + 15_000,
      'Northflank execution',
    );
  } catch (err) {
    return failedResult(
      err instanceof Error ? err.message : 'Northflank execution failed.',
      startTime,
    );
  } finally {
    if (client) {
      await safeCleanup(() => client!.delete.service({ parameters: { projectId, serviceId } }));
    }
  }
}

export const northflankAdapter: SandboxProviderAdapter = {
  id: 'northflank',
  verifyCredentials,
  healthCheck,
  execute,
};
