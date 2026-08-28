type EnterpriseProfile = {
  dashboardUrl: string;
  clientKey: string;
  managedToolIds: string[];
};

export type EnterpriseToolDescriptor = { id: string; name: string; description: string; ui: 'notice' | 'table' | 'card' };

function profile(config: any): EnterpriseProfile | null {
  const enterprise = config?.enterprise as EnterpriseProfile | undefined;
  if (!enterprise?.dashboardUrl || !enterprise.clientKey) return null;
  return enterprise;
}

async function enterpriseFetch(config: any, path: string, init?: RequestInit) {
  const enterprise = profile(config);
  if (!enterprise) return null;
  const url = new URL(path, enterprise.dashboardUrl);
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${enterprise.clientKey}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error('Enterprise private tool is unavailable.');
  return response.json();
}

export async function getEnterpriseTools(config: any): Promise<EnterpriseToolDescriptor[]> {
  const enterprise = profile(config);
  if (!enterprise?.managedToolIds.length) return [];
  try {
    const data = await enterpriseFetch(config, '/api/client/tools') as { tools?: EnterpriseToolDescriptor[] } | null;
    return (data?.tools || []).filter((tool) => enterprise.managedToolIds.includes(tool.id));
  } catch (error) {
    console.error('[enterprise] private tools unavailable:', error);
    return [];
  }
}

export async function executeEnterpriseTool(config: any, id: string, input: { query?: string }) {
  return enterpriseFetch(config, `/api/client/tools/${encodeURIComponent(id)}/execute`, { method: 'POST', body: JSON.stringify(input) });
}

/** Do this before model invocation so a paused or exhausted client cannot spend more. */
export async function authorizeEnterpriseAiRequest(config: any) {
  if (!profile(config)) return;
  await enterpriseFetch(config, '/api/client/authorize', { method: 'POST', body: '{}' });
}

export function trackEnterpriseAiUsage(config: any, event: { modelId: string; inputTokens: number; outputTokens: number; costUsd: number }) {
  void enterpriseFetch(config, '/api/client/usage', { method: 'POST', body: JSON.stringify({ service: 'ai', ...event }) }).catch(() => undefined);
}

/**
 * Reports one meter's usage for an installed Marketplace catalog tool. This
 * is the `trackUsage` sink wired into every dynamically-loaded ToolExtension
 * client for an EE-enrolled installation — generic across tools, since the
 * meter id and quantity always come from the tool itself, never hardcoded
 * here. A no-op when the workspace isn't enrolled with Enterprise.
 */
export function trackEnterpriseToolUsage(
  config: any,
  toolId: string,
  event: { meter: string; quantity: number; unit: string },
) {
  void enterpriseFetch(config, '/api/client/usage', {
    method: 'POST',
    body: JSON.stringify({ service: 'tool', toolId, meterId: event.meter, quantity: event.quantity, unit: event.unit }),
  }).catch(() => undefined);
}
