/**
 * Server-only configuration. This module must never be imported by client
 * components — it reads the controller token and URL, which stay server-side.
 */
import type { BackendMode } from '../contract.js';

export type ServerConfig = {
  mode: BackendMode;
  controllerUrl: string | null;
  /** Present only on the server; never serialized to the browser. */
  controllerToken: string | null;
  allowedOrigins: string[];
  port: number;
  readonly: boolean;
};

function parseMode(raw: string | undefined, hasUrl: boolean): BackendMode {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'proxy' || v === 'offline' || v === 'mock') return v;
  // Default: proxy only if a controller URL is configured, otherwise mock.
  return hasUrl ? 'proxy' : 'mock';
}

let cached: ServerConfig | null = null;

export function serverConfig(): ServerConfig {
  if (cached) return cached;
  const controllerUrl = (process.env.BENCHMARK_CONTROLLER_URL || '').trim() || null;
  const controllerToken = (process.env.BENCHMARK_CONTROLLER_TOKEN || '').trim() || null;
  const port = Number(process.env.PORT || 3100);
  const explicitOrigins = (process.env.DASHBOARD_ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const defaultOrigins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
  cached = {
    mode: parseMode(process.env.DASHBOARD_MODE, Boolean(controllerUrl)),
    controllerUrl,
    controllerToken,
    allowedOrigins: explicitOrigins.length ? explicitOrigins : defaultOrigins,
    port,
    readonly: process.env.BENCHMARK_READ_ONLY === '1',
  };
  return cached;
}

/** Public, browser-safe view of the config — NEVER includes url or token. */
export function publicConfig() {
  const c = serverConfig();
  return {
    mode: c.mode,
    writesEnabled: c.mode !== 'offline' && !c.readonly,
    controllerConfigured: Boolean(c.controllerUrl),
  };
}
