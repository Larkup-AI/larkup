import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { promisify } from 'node:util';
import type { VideoIntelligenceClient } from './client.js';

const execute = promisify(execFile);

/** Starts the shipped local runtime only after the user selected local Docker mode. */
export async function ensureVideoRuntime(
  client: VideoIntelligenceClient,
  mode: 'local-docker' | 'managed-cloud' | 'custom-remote',
  localApiKey?: string,
  localRuntimeUrl?: string,
): Promise<void> {
  try {
    await client.health();
    return;
  } catch (error) {
    if (mode !== 'local-docker') throw error;
  }
  const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  try {
    await execute(
      'docker',
      ['compose', '-f', path.join(packageDirectory, 'compose.yaml'), 'up', '-d', '--wait'],
      {
        timeout: 15 * 60_000,
        maxBuffer: 1024 * 1024,
        env: localRuntimeEnvironment(localApiKey, localRuntimeUrl),
      },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        'Docker Desktop is required for the local runtime. Install it and make sure Docker is running.',
      );
    }
    throw error;
  }
  await client.health();
}

/** Recreates the local container so a changed shared key is applied immediately. */
export async function restartVideoRuntime(
  localApiKey?: string,
  localRuntimeUrl?: string,
): Promise<void> {
  const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  try {
    await execute(
      'docker',
      [
        'compose',
        '-f',
        path.join(packageDirectory, 'compose.yaml'),
        'up',
        '-d',
        '--force-recreate',
        '--wait',
      ],
      {
        timeout: 15 * 60_000,
        maxBuffer: 1024 * 1024,
        env: localRuntimeEnvironment(localApiKey, localRuntimeUrl),
      },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        'Docker Desktop is required for the local runtime. Install it and make sure Docker is running.',
      );
    }
    throw error;
  }
}

function localRuntimeEnvironment(localApiKey?: string, localRuntimeUrl?: string) {
  const port = portFromUrl(localRuntimeUrl);
  return {
    ...process.env,
    ...(port ? { LARKUP_VIDEO_PORT: port } : {}),
    ...(localApiKey
      ? { LARKUP_VIDEO_REQUIRE_AUTH: 'true', LARKUP_VIDEO_SHARED_API_KEY: localApiKey }
      : {}),
  };
}

function portFromUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const port = new URL(value).port;
    return port && Number.isInteger(Number(port)) && Number(port) > 0 && Number(port) < 65_536
      ? port
      : undefined;
  } catch {
    return undefined;
  }
}
