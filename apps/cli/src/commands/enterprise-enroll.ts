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

function enrollmentUrl(baseUrl: string): URL {
  const url = new URL('/api/enrollment', baseUrl);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error('Enterprise dashboard URL must use HTTPS.');
  }
  return url;
}

/** Enroll a local Larkup project from a one-time Enterprise install key. */
export async function enterpriseEnrollCommand(options: { url: string; key: string }) {
  if (!options.key.trim()) throw new Error('An Enterprise enrollment key is required.');

  const endpoint = enrollmentUrl(options.url);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: options.key.trim() }),
  });
  const payload = (await response.json().catch(() => ({}))) as EnrollmentProfile & { error?: string };
  if (!response.ok || !payload.organization || !payload.installation) {
    throw new Error(payload.error || 'The Enterprise enrollment key is invalid or has expired.');
  }

  const { project } = await createProject(payload.organization.name);
  await runWithProject(project.id, async () => {
    const config = await readConfig();
    await writeConfig({
      ...config,
      projectName: payload.organization.name,
      chatProvider: payload.configuration.chatProvider || config.chatProvider,
      chatModelId: payload.configuration.chatModelId || config.chatModelId,
      chatApiKey: payload.configuration.chatApiKey || config.chatApiKey,
      embeddingProvider: payload.configuration.embeddingProvider || config.embeddingProvider,
      embeddingModelId: payload.configuration.embeddingModelId || config.embeddingModelId,
      embeddingApiKey: payload.configuration.embeddingApiKey || config.embeddingApiKey,
      enterprise: {
        organizationId: payload.organization.id,
        organizationName: payload.organization.name,
        dashboardUrl: new URL(options.url).origin,
        installationId: payload.installation.id,
        clientKey: payload.installation.clientKey,
        // Entitlement and installation are intentionally separate. A customer
        // receives a private tool ID from us, then explicitly installs it with
        // its tool API key using `larkup enterprise-tool install`.
        managedToolIds: [],
        enrolledAt: new Date().toISOString(),
      },
    });
  });

  log.success(`Enterprise profile for ${log.fmt.bold(payload.organization.name)} is ready.`);
  const available = payload.managedTools.map((tool) => tool.id).join(', ');
  log.dim('Larkup will start with this configured Project; no onboarding is required.');
  if (available) log.dim(`Private tools available to this client: ${available}`);
}
