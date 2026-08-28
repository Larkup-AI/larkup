/**
 * WebContainers adapter — https://webcontainers.io/
 *
 * `@webcontainer/api` boots a WebAssembly Node.js runtime that only runs
 * inside a cross-origin-isolated browser tab (it needs SharedArrayBuffer) —
 * there is no Node.js/server-side entry point at all, so `execute()` fails
 * fast. The optional "license key" field is a StackBlitz-issued commercial
 * key consumed by `WebContainer.configureAPIKey()` in the browser; there is
 * no server-reachable endpoint to validate it against, so `verifyCredentials`
 * says so honestly rather than reporting a false positive.
 */

import type { SandboxHealthCheck, ExecutionRequest, ExecutionResult, SandboxProviderAdapter } from '../types.js';
import { failedResult } from '../remote-exec.js';
import { SANDBOX_PROVIDERS } from '../registry.js';

async function verifyCredentials(_credentials: Record<string, string>): Promise<void> {
  throw new Error(
    'WebContainers has no server-side credential check — the license key is only validated by StackBlitz when WebContainer.boot() runs in the browser.',
  );
}

async function healthCheck(_credentials: Record<string, string>): Promise<SandboxHealthCheck> {
  return { status: 'unsupported', backend: 'webcontainers', error: SANDBOX_PROVIDERS.webcontainers.executionCaveat };
}

async function execute(_request: ExecutionRequest, _credentials: Record<string, string>): Promise<ExecutionResult> {
  return failedResult(SANDBOX_PROVIDERS.webcontainers.executionCaveat!, Date.now());
}

export const webcontainersAdapter: SandboxProviderAdapter = {
  id: 'webcontainers',
  verifyCredentials,
  healthCheck,
  execute,
};
