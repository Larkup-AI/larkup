import { readConfig, writeConfig } from '@larkup/core/config-store';
import * as p from '@clack/prompts';
import { log } from '../ui/logger';

type ToolInstallResponse = { tool?: { id: string; name: string }; error?: string };

/** Installs an organization-entitled private tool without using the public Hub. */
export async function enterpriseToolInstallCommand(toolId: string, options: { apiKey?: string }) {
  const config = await readConfig();
  const enterprise = config.enterprise;
  if (!enterprise) throw new Error('This Project is not enrolled with an Enterprise profile.');
  if (!toolId.trim()) throw new Error('A private tool ID is required.');

  let apiKey = options.apiKey?.trim();
  if (!apiKey) {
    const answer = await p.password({ message: `API key for private tool ${toolId}`, mask: '•' });
    if (p.isCancel(answer)) throw new Error('Private tool installation cancelled.');
    apiKey = typeof answer === 'string' ? answer.trim() : undefined;
  }

  const endpoint = new URL(`/api/client/tools/${encodeURIComponent(toolId)}/install`, enterprise.dashboardUrl);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${enterprise.clientKey}`,
    },
    body: JSON.stringify({ apiKey: apiKey || undefined }),
  });
  const payload = (await response.json().catch(() => ({}))) as ToolInstallResponse;
  if (!response.ok || !payload.tool) throw new Error(payload.error || 'Private tool installation failed.');

  await writeConfig({
    ...config,
    enterprise: {
      ...enterprise,
      managedToolIds: [...new Set([...enterprise.managedToolIds, payload.tool.id])],
    },
  });
  log.success(`Installed private tool ${log.fmt.bold(payload.tool.name)}.`);
}
