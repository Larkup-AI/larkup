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
): Promise<void> {
  try {
    await client.health();
    return;
  } catch (error) {
    if (mode !== 'local-docker') throw error;
  }
  const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  await execute(
    'docker',
    ['compose', '-f', path.join(packageDirectory, 'compose.yaml'), 'up', '-d', '--wait'],
    { timeout: 15 * 60_000, maxBuffer: 1024 * 1024 },
  );
  await client.health();
}
