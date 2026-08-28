import { existsSync } from 'node:fs';

/**
 * Runtime environment the app is running in.
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
