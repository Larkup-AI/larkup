import { existsSync } from 'node:fs';

/**
 * Runtime environment the app is running in.
 *
 * - "web"     → local dev / standalone Next.js on the host
 * - "desktop" → bundled inside Tauri as a sidecar
 * - "docker"  → running inside a Docker container
 */
export type RuntimeEnv = 'web' | 'desktop' | 'docker';

/** Detect the current runtime environment (server-side only). */
export function getRuntimeEnv(): RuntimeEnv {
  if (process.env.TAURI_ENV_PLATFORM || process.env.TAURI_ENV_ARCH) {
    return 'desktop';
  }

  if (
    process.env.DOCKER_ENV === 'true' ||
    process.env.DOCKER_BUILD === '1' ||
    existsSync('/.dockerenv')
  ) {
    return 'docker';
  }

  return 'web';
}
