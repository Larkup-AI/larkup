import { createProject, runWithProject } from '@larkup/core/project-store';
import { readConfig, writeConfig } from '@larkup/core/config-store';
import { log } from '../ui/logger';

type EnrollmentProfile = {
  installation: { id: string; clientKey: string };
  organization: { id: string; name: string };
  configuration: {
    chatProvider?: string;
    chatModelId?: string;
    chatApiKey?: string;
    embeddingProvider?: string;
    embeddingModelId?: string;
    embeddingApiKey?: string;
  };
  managedTools: Array<{ id: string }>;
};

type ToolInstallResponse = { tool?: { id: string; name: string }; error?: string };

function enterpriseEndpoint(baseUrl: string, pathname: string): URL {
  const url = new URL(pathname, baseUrl);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error('Enterprise dashboard URL must use HTTPS.');
  }
  return url;
}

export interface InstallOptions {
  ee?: boolean;
  apikey?: string;
  installtools?: string;
  url?: string;
}

/**
 * `larkup install --ee --apikey <organization-enrollment-key> --installtools a,b`
 *
 * One command that does what `enterprise-enroll` + repeated
 * `enterprise-tool install` calls did separately: redeem the org's
 * enrollment key, create a fully-configured local Project (onboarding is
 * skipped because a configured, active Project already exists), then install
 * every requested, org-entitled tool. Tools that require a customer-supplied
 * credential are reported, not silently skipped — finish those with
 * `larkup enterprise-tool install <id> --api-key <key>`.
 */
export async function installCommand(options: InstallOptions) {
  if (!options.ee) {
    throw new Error(
      '`larkup install` currently only supports Enterprise installs — pass --ee. ' +
        'Use `larkup marketplace install <tool-id>` for a single Marketplace tool.',
    );
  }
  const apikey = options.apikey?.trim();
  if (!apikey) throw new Error('--apikey <organization-enrollment-key> is required.');
  const dashboardUrl = options.url || process.env.LARKUP_EE_URL;
  if (!dashboardUrl) {
    throw new Error('An Enterprise dashboard URL is required: pass --url <dashboard-url> or set LARKUP_EE_URL.');
  }

  const enrollResponse = await fetch(enterpriseEndpoint(dashboardUrl, '/api/enrollment'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: apikey }),
  });
  const profile = (await enrollResponse.json().catch(() => ({}))) as EnrollmentProfile & { error?: string };
  if (!enrollResponse.ok || !profile.organization || !profile.installation) {
    throw new Error(profile.error || 'The Enterprise enrollment key is invalid or has expired.');
  }

  const { project } = await createProject(profile.organization.name);
  await runWithProject(project.id, async () => {
    const config = await readConfig();
    await writeConfig({
      ...config,
      projectName: profile.organization.name,
      chatProvider: profile.configuration.chatProvider || config.chatProvider,
      chatModelId: profile.configuration.chatModelId || config.chatModelId,
      chatApiKey: profile.configuration.chatApiKey || config.chatApiKey,
      embeddingProvider: profile.configuration.embeddingProvider || config.embeddingProvider,
      embeddingModelId: profile.configuration.embeddingModelId || config.embeddingModelId,
      embeddingApiKey: profile.configuration.embeddingApiKey || config.embeddingApiKey,
      enterprise: {
        organizationId: profile.organization.id,
        organizationName: profile.organization.name,
        dashboardUrl: new URL(dashboardUrl).origin,
        installationId: profile.installation.id,
        clientKey: profile.installation.clientKey,
        managedToolIds: [],
        configurationVersion: 0,
        enrolledAt: new Date().toISOString(),
      },
    });
  });

  log.success(`Enterprise profile for ${log.fmt.bold(profile.organization.name)} is ready. No onboarding is required.`);

  const requested = (options.installtools || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  if (!requested.length) return;

  const managedIds = new Set(profile.managedTools.map((tool) => tool.id));
  const installed: string[] = [];
  const failed: string[] = [];
  const notEntitled: string[] = [];

  await runWithProject(project.id, async () => {
    const config = await readConfig();
    const enterprise = config.enterprise;
    if (!enterprise) return;

    for (const toolId of requested) {
      if (!managedIds.has(toolId)) {
        notEntitled.push(toolId);
        continue;
      }
      const response = await fetch(enterpriseEndpoint(dashboardUrl, `/api/client/tools/${encodeURIComponent(toolId)}/install`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${enterprise.clientKey}` },
        body: JSON.stringify({}),
      });
      const result = (await response.json().catch(() => ({}))) as ToolInstallResponse;
      if (response.ok && result.tool) {
        installed.push(result.tool.id);
        enterprise.managedToolIds = [...new Set([...enterprise.managedToolIds, result.tool.id])];
      } else {
        failed.push(`${toolId} (${result.error || 'install failed'})`);
      }
    }
    await writeConfig({ ...config, enterprise });
  });

  if (installed.length) log.success(`Installed: ${installed.join(', ')}`);
  if (failed.length) {
    log.warn(`Needs attention — run \`larkup enterprise-tool install <id> --api-key <key>\` if a key is required: ${failed.join(', ')}`);
  }
  if (notEntitled.length) log.error(`Not entitled for this organization: ${notEntitled.join(', ')}`);
}
