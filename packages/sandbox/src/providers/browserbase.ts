/**
 * Browserbase adapter — https://docs.browserbase.com/welcome/introduction
 *
 * Browserbase provisions headless-Chrome sessions for Playwright/Puppeteer
 * automation, not an arbitrary code-execution sandbox — see
 * SANDBOX_PROVIDERS.browserbase.executionCaveat. `execute()` fails fast with
 * that explanation instead of pretending to run Python/JS here.
 * `verifyCredentials`/`healthCheck` are still fully real: they confirm the
 * API key and project actually work.
 */

import type {
  SandboxHealthCheck,
  ExecutionRequest,
  ExecutionResult,
  SandboxProviderAdapter,
} from '../types.js';
import { failedResult } from '../remote-exec.js';
import { SANDBOX_PROVIDERS } from '../registry.js';

interface BrowserbaseProject {
  id: string;
}

interface BrowserbaseClient {
  projects: { list(): Promise<BrowserbaseProject[]> };
}

interface BrowserbaseModule {
  default: new (opts: { apiKey: string }) => BrowserbaseClient;
}

async function loadSdk(): Promise<BrowserbaseModule> {
  return (await import('@browserbasehq/sdk')) as unknown as BrowserbaseModule;
}

function requireFields(credentials: Record<string, string>): { apiKey: string; projectId: string } {
  const apiKey = credentials.apiKey?.trim();
  const projectId = credentials.projectId?.trim();
  if (!apiKey || !projectId)
    throw new Error('Browserbase API key and project ID are both required.');
  return { apiKey, projectId };
}

async function verifyCredentials(credentials: Record<string, string>): Promise<void> {
  const { apiKey, projectId } = requireFields(credentials);
  const { default: Browserbase } = await loadSdk();
  const client = new Browserbase({ apiKey });
  const projects = await client.projects.list();
  if (!projects.some((project) => project.id === projectId)) {
    throw new Error('This API key cannot see the given Browserbase project ID.');
  }
}

async function healthCheck(credentials: Record<string, string>): Promise<SandboxHealthCheck> {
  const caveat = SANDBOX_PROVIDERS.browserbase.executionCaveat;
  if (!credentials.apiKey?.trim() || !credentials.projectId?.trim()) {
    return {
      status: 'missing-credentials',
      backend: 'browserbase',
      error: 'Browserbase API key and project ID are required.',
    };
  }
  try {
    await verifyCredentials(credentials);
    return { status: 'unsupported', backend: 'browserbase', error: caveat };
  } catch (err) {
    return {
      status: 'error',
      backend: 'browserbase',
      error: err instanceof Error ? err.message : 'Browserbase health check failed.',
    };
  }
}

async function execute(
  _request: ExecutionRequest,
  _credentials: Record<string, string>,
): Promise<ExecutionResult> {
  return failedResult(SANDBOX_PROVIDERS.browserbase.executionCaveat!, Date.now());
}

export const browserbaseAdapter: SandboxProviderAdapter = {
  id: 'browserbase',
  verifyCredentials,
  healthCheck,
  execute,
};
