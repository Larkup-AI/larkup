/**
 * Fly.io Sprites adapter — https://fly.io/sprites/
 *
 * The `@fly/sprites` SDK is very early (0.2.x) and its docs don't confirm a
 * dedicated whoami/list call. `verifyCredentials` falls back to creating and
 * immediately deleting a throwaway sprite if no lighter check is exposed.
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

interface Sprite {
  exec(script: string): Promise<{ stdout?: string; stderr?: string }>;
  delete(): Promise<void>;
}

interface SpritesClientInstance {
  createSprite(name: string): Promise<Sprite>;
  listSprites?(): Promise<unknown[]>;
}

interface SpritesModule {
  SpritesClient: new (token: string) => SpritesClientInstance;
}

interface SpriteExecError extends Error {
  exitCode?: number;
  stdout?: string;
  stderr?: string;
}

async function loadSdk(): Promise<SpritesModule> {
  // @ts-ignore
  return (await import(/* webpackIgnore: true */ '@fly/sprites')) as unknown as SpritesModule;
}

function requireToken(credentials: Record<string, string>): string {
  const token = credentials.token?.trim();
  if (!token) throw new Error('Fly Sprites token is required.');
  return token;
}

async function verifyCredentials(credentials: Record<string, string>): Promise<void> {
  const token = requireToken(credentials);
  const { SpritesClient } = await loadSdk();
  const client = new SpritesClient(token);
  if (typeof client.listSprites === 'function') {
    await client.listSprites();
    return;
  }
  const sprite = await client.createSprite(`larkup-verify-${randomUUID().slice(0, 8)}`);
  await safeCleanup(() => sprite.delete());
}

async function healthCheck(credentials: Record<string, string>): Promise<SandboxHealthCheck> {
  if (!credentials.token?.trim()) {
    return {
      status: 'missing-credentials',
      backend: 'flyio',
      error: 'Fly Sprites token is required.',
    };
  }
  try {
    await verifyCredentials(credentials);
    return { status: 'ready', backend: 'flyio' };
  } catch (err) {
    return {
      status: 'error',
      backend: 'flyio',
      error: err instanceof Error ? err.message : 'Fly Sprites health check failed.',
    };
  }
}

async function execute(
  request: ExecutionRequest,
  credentials: Record<string, string>,
): Promise<ExecutionResult> {
  const startTime = Date.now();
  let token: string;
  try {
    token = requireToken(credentials);
  } catch (err) {
    return failedResult(
      err instanceof Error ? err.message : 'Missing Fly Sprites token.',
      startTime,
    );
  }

  const timeoutMs = request.timeout ?? DEFAULT_TIMEOUT_MS;
  let sprite: Sprite | undefined;
  try {
    const { SpritesClient } = await loadSdk();
    const client = new SpritesClient(token);
    sprite = await withTimeout(
      client.createSprite(`larkup-${randomUUID().slice(0, 8)}`),
      timeoutMs + 30_000,
      'Fly Sprite create',
    );
    const activeSprite = sprite;
    return await withTimeout(
      runScriptedExecution(async (script) => {
        try {
          const result = await activeSprite.exec(script);
          return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', exitCode: 0 };
        } catch (err) {
          const execErr = err as SpriteExecError;
          if (execErr && typeof execErr.exitCode === 'number') {
            return {
              stdout: execErr.stdout ?? '',
              stderr: execErr.stderr ?? execErr.message,
              exitCode: execErr.exitCode,
            };
          }
          throw err;
        }
      }, request),
      timeoutMs + 15_000,
      'Fly Sprite execution',
    );
  } catch (err) {
    return failedResult(
      err instanceof Error ? err.message : 'Fly Sprites execution failed.',
      startTime,
    );
  } finally {
    if (sprite) await safeCleanup(() => sprite!.delete());
  }
}

export const flyioAdapter: SandboxProviderAdapter = {
  id: 'flyio',
  verifyCredentials,
  healthCheck,
  execute,
};
