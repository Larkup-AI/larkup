/**
 * Modal adapter — https://modal.com/docs/guide/sandboxes
 *
 * The Modal JavaScript SDK is client-based: create a ModalClient with the
 * configured credentials, then create sandboxes through `modal.sandboxes`.
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

interface ModalProcess {
  stdout: { readText(): Promise<string> };
  stderr: { readText(): Promise<string> };
  wait(): Promise<number>;
}

interface ModalSandbox {
  exec(command: string[], params?: { timeoutMs?: number }): Promise<ModalProcess>;
  terminate(): Promise<void>;
}

interface ModalClient {
  apps: {
    fromName(name: string, options?: { createIfMissing?: boolean }): Promise<unknown>;
  };
  images: {
    fromRegistry(name: string): unknown;
  };
  sandboxes: {
    create(
      app: unknown,
      image: unknown,
      options?: { timeoutMs?: number; idleTimeoutMs?: number },
    ): Promise<ModalSandbox>;
  };
  getImageBuilderVersion(): Promise<string>;
  close(): void;
}

interface ModalModule {
  ModalClient: new (options: { tokenId: string; tokenSecret: string }) => ModalClient;
}

async function loadSdk(): Promise<ModalModule> {
  return (await import('modal')) as unknown as ModalModule;
}

function requireFields(credentials: Record<string, string>): {
  tokenId: string;
  tokenSecret: string;
} {
  const tokenId = credentials.tokenId?.trim();
  const tokenSecret = credentials.tokenSecret?.trim();
  if (!tokenId || !tokenSecret)
    throw new Error('Modal token ID and token secret are both required.');
  return { tokenId, tokenSecret };
}

async function createClient(tokenId: string, tokenSecret: string): Promise<ModalClient> {
  const { ModalClient } = await loadSdk();
  return new ModalClient({ tokenId, tokenSecret });
}

async function verifyCredentials(credentials: Record<string, string>): Promise<void> {
  const { tokenId, tokenSecret } = requireFields(credentials);
  const modal = await createClient(tokenId, tokenSecret);
  try {
    await withTimeout(modal.getImageBuilderVersion(), 20_000, 'Modal credential check');
  } finally {
    modal.close();
  }
}

async function healthCheck(credentials: Record<string, string>): Promise<SandboxHealthCheck> {
  if (!credentials.tokenId?.trim() || !credentials.tokenSecret?.trim()) {
    return {
      status: 'missing-credentials',
      backend: 'modal',
      error: 'Modal token ID and secret are required.',
    };
  }
  try {
    await verifyCredentials(credentials);
    return { status: 'ready', backend: 'modal' };
  } catch (err) {
    return {
      status: 'error',
      backend: 'modal',
      error: err instanceof Error ? err.message : 'Modal health check failed.',
    };
  }
}

async function execute(
  request: ExecutionRequest,
  credentials: Record<string, string>,
): Promise<ExecutionResult> {
  const startTime = Date.now();
  let fields: { tokenId: string; tokenSecret: string };
  try {
    fields = requireFields(credentials);
  } catch (err) {
    return failedResult(
      err instanceof Error ? err.message : 'Missing Modal credentials.',
      startTime,
    );
  }

  const timeoutMs = request.timeout ?? DEFAULT_TIMEOUT_MS;
  const modal = await createClient(fields.tokenId, fields.tokenSecret);
  let sandbox: ModalSandbox | undefined;
  try {
    const app = await withTimeout(
      modal.apps.fromName('larkup-sandbox', { createIfMissing: true }),
      timeoutMs + 15_000,
      'Modal app setup',
    );
    const image = modal.images.fromRegistry(
      request.language === 'python' ? 'python:3.13-slim' : 'node:22-bookworm-slim',
    );
    sandbox = await withTimeout(
      modal.sandboxes.create(app, image, {
        timeoutMs: timeoutMs + 60_000,
        idleTimeoutMs: timeoutMs + 30_000,
      }),
      timeoutMs + 30_000,
      'Modal sandbox create',
    );
    const activeSandbox = sandbox;
    return await withTimeout(
      runScriptedExecution(async (script) => {
        const process = await activeSandbox.exec(['bash', '-lc', script], { timeoutMs });
        const [stdout, stderr, exitCode] = await Promise.all([
          process.stdout.readText(),
          process.stderr.readText(),
          process.wait(),
        ]);
        return { stdout, stderr, exitCode };
      }, request),
      timeoutMs + 15_000,
      'Modal execution',
    );
  } catch (err) {
    return failedResult(err instanceof Error ? err.message : 'Modal execution failed.', startTime);
  } finally {
    if (sandbox) await safeCleanup(() => sandbox!.terminate());
    modal.close();
  }
}

export const modalAdapter: SandboxProviderAdapter = {
  id: 'modal',
  verifyCredentials,
  healthCheck,
  execute,
};
