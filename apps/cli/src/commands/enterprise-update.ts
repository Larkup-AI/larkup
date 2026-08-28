import { readConfig, writeConfig } from '@larkup/core/config-store';
import { log } from '../ui/logger';

type EnterpriseProfile = {
  organizationId: string;
  configurationVersion: number;
  onboarding: { skipWelcome: true };
  aiGateway: {
    enabled: boolean;
    allowedModels: string[];
    limits: { monthlyBudgetUsd: number | null; dailyBudgetUsd: number | null; rateLimitPerMinute: number | null };
  };
  tools: Array<{
    toolId: string;
    enabled: true;
    requiresApiKey: boolean;
    hasCredential: boolean;
    limits: Record<string, { limitPerDay: number | null; limitPerMonth: number | null }>;
    fallbackMode: string;
  }>;
};

function enterpriseEndpoint(baseUrl: string, pathname: string): URL {
  const url = new URL(pathname, baseUrl);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error('Enterprise dashboard URL must use HTTPS.');
  }
  return url;
}

/**
 * `larkup update --ee` — syncs this installation against its organization's
 * versioned Enterprise Profile: newly granted tools are installed, revoked
 * tools are dropped locally, and the local `configurationVersion` is
 * advanced so the next run is a no-op unless the dashboard changes again.
 */
export async function updateEnterpriseCommand() {
  const config = await readConfig();
  const enterprise = config.enterprise;
  if (!enterprise) {
    throw new Error('This Project is not enrolled with an Enterprise profile. Run `larkup install --ee` first.');
  }

  const response = await fetch(enterpriseEndpoint(enterprise.dashboardUrl, '/api/client/config'), {
    headers: { Authorization: `Bearer ${enterprise.clientKey}` },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || 'Could not reach the Enterprise dashboard.');
  }
  const profile = (await response.json()) as EnterpriseProfile;

  const localVersion = enterprise.configurationVersion ?? 0;
  if (profile.configurationVersion === localVersion) {
    log.success('Enterprise configuration is up to date.');
    return;
  }

  const remoteToolIds = new Set(profile.tools.map((tool) => tool.toolId));
  let managedToolIds = [...enterprise.managedToolIds];

  const added: string[] = [];
  const needsCredential: string[] = [];
  for (const tool of profile.tools) {
    if (managedToolIds.includes(tool.toolId)) continue;
    if (tool.requiresApiKey && !tool.hasCredential) {
      needsCredential.push(tool.toolId);
      continue;
    }
    const installResponse = await fetch(
      enterpriseEndpoint(enterprise.dashboardUrl, `/api/client/tools/${encodeURIComponent(tool.toolId)}/install`),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${enterprise.clientKey}` },
        body: JSON.stringify({}),
      },
    );
    if (installResponse.ok) {
      added.push(tool.toolId);
      managedToolIds = [...new Set([...managedToolIds, tool.toolId])];
    } else {
      needsCredential.push(tool.toolId);
    }
  }

  const removed = managedToolIds.filter((id) => !remoteToolIds.has(id));
  managedToolIds = managedToolIds.filter((id) => remoteToolIds.has(id));

  await writeConfig({
    ...config,
    enterprise: { ...enterprise, managedToolIds, configurationVersion: profile.configurationVersion },
  });

  log.success(`Enterprise configuration updated (v${localVersion} → v${profile.configurationVersion}).`);
  if (added.length) log.info(`Newly installed: ${added.join(', ')}`);
  if (removed.length) log.info(`Removed (revoked): ${removed.join(', ')}`);
  if (needsCredential.length) {
    log.warn(`Needs credentials — run \`larkup enterprise-tool install <id> --api-key <key>\`: ${needsCredential.join(', ')}`);
  }
  if (!added.length && !removed.length && !needsCredential.length) {
    log.dim('No tool changes. Limits and policy were refreshed.');
  }
}

/** Cheap background check used to print the "run larkup update --ee" nudge on startup. Never throws. */
export async function enterpriseUpdateAvailable(): Promise<boolean> {
  try {
    const config = await readConfig();
    const enterprise = config.enterprise;
    if (!enterprise) return false;
    const response = await fetch(enterpriseEndpoint(enterprise.dashboardUrl, '/api/client/config'), {
      headers: { Authorization: `Bearer ${enterprise.clientKey}` },
    });
    if (!response.ok) return false;
    const profile = (await response.json()) as EnterpriseProfile;
    return profile.configurationVersion !== (enterprise.configurationVersion ?? 0);
  } catch {
    return false;
  }
}
