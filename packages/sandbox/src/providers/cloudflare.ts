/**
 * Cloudflare Sandbox adapter — https://developers.cloudflare.com/sandbox/
 */

import type {
  SandboxHealthCheck,
  ExecutionRequest,
  ExecutionResult,
  SandboxProviderAdapter,
} from '../types.js';
import { failedResult } from '../remote-exec.js';
import { SANDBOX_PROVIDERS } from '../registry.js';

function requireFields(credentials: Record<string, string>): {
  apiToken: string;
  accountId: string;
} {
  const apiToken = credentials.apiToken?.trim();
  const accountId = credentials.accountId?.trim();
  if (!apiToken || !accountId)
    throw new Error('Cloudflare API token and account ID are both required.');
  return { apiToken, accountId };
}

async function verifyCredentials(credentials: Record<string, string>): Promise<void> {
  const { apiToken, accountId } = requireFields(credentials);

  const tokenRes = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', {
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  if (!tokenRes.ok) throw new Error(`Cloudflare rejected the API token (${tokenRes.status}).`);

  const accountRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}`, {
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  if (!accountRes.ok) throw new Error('This API token cannot see the given Cloudflare account ID.');
}

async function healthCheck(credentials: Record<string, string>): Promise<SandboxHealthCheck> {
  const caveat = SANDBOX_PROVIDERS.cloudflare.executionCaveat;
  if (!credentials.apiToken?.trim() || !credentials.accountId?.trim()) {
    return {
      status: 'missing-credentials',
      backend: 'cloudflare',
      error: 'Cloudflare API token and account ID are required.',
    };
  }
  try {
    await verifyCredentials(credentials);
    return { status: 'unsupported', backend: 'cloudflare', error: caveat };
  } catch (err) {
    return {
      status: 'error',
      backend: 'cloudflare',
      error: err instanceof Error ? err.message : 'Cloudflare health check failed.',
    };
  }
}

async function execute(
  _request: ExecutionRequest,
  _credentials: Record<string, string>,
): Promise<ExecutionResult> {
  return failedResult(SANDBOX_PROVIDERS.cloudflare.executionCaveat!, Date.now());
}

export const cloudflareAdapter: SandboxProviderAdapter = {
  id: 'cloudflare',
  verifyCredentials,
  healthCheck,
  execute,
};
