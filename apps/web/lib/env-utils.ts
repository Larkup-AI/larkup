import { existsSync } from "node:fs";

/**
 * Runtime environment the app is running in.
 *
 * - "web"     → local dev / standalone Next.js on the host
 * - "desktop" → bundled inside Tauri as a sidecar
 * - "docker"  → running inside a Docker container
 */
export type RuntimeEnv = "web" | "desktop" | "docker";

/** Detect the current runtime environment (server-side only). */
export function getRuntimeEnv(): RuntimeEnv {
  // Tauri injects TAURI_ENV_PLATFORM during builds and sets it at runtime.
  // The sidecar binary also runs from within the Tauri bundle directory.
  if (process.env.TAURI_ENV_PLATFORM || process.env.TAURI_ENV_ARCH) {
    return "desktop";
  }

  // Docker containers have /.dockerenv or the DOCKER_ENV env var we set in compose.
  if (
    process.env.DOCKER_ENV === "true" ||
    process.env.DOCKER_BUILD === "1" ||
    existsSync("/.dockerenv")
  ) {
    return "docker";
  }

  return "web";
}
