import { randomUUID } from 'node:crypto';
import { readConfig, writeConfig } from '@larkup/core/config-store';

type ProvisioningClient = {
  provisionDeviceAccess?: (installationId: string) => Promise<{
    apiKey: string;
    entitlement: {
      plan: string;
      sourceMinutesPerMonth: number | null;
      maxConcurrentJobs: number;
      allowFullCoverage: boolean;
    };
  }>;
};

type VideoExtension = {
  createClient(context: {
    config: Record<string, unknown>;
    fetch?: typeof globalThis.fetch;
  }): ProvisioningClient;
};

/**
 * Creates a per-installation cloud credential once, then keeps it in this
 * project's local config. The cloud stores hashes of both identifiers only.
 */
export async function resolveVideoIntelligenceConnection(
  extension: VideoExtension,
  installedConfig: Record<string, unknown>,
): Promise<{
  config: Record<string, unknown>;
  provisioned: boolean;
  entitlement?: {
    plan: string;
    sourceMinutesPerMonth: number | null;
    maxConcurrentJobs: number;
    allowFullCoverage: boolean;
  };
}> {
  const globalConfig = await readConfig();
  const current = {
    ...installedConfig,
    ...(globalConfig.toolConfigs?.['video-intelligence'] ?? {}),
  };
  const forceProvision = current.forceProvisionManagedCloud === true;
  const { forceProvisionManagedCloud: _forceProvisionManagedCloud, ...connectionConfig } = current;
  if (connectionConfig.runtimeMode && connectionConfig.runtimeMode !== 'managed-cloud') {
    return { config: connectionConfig, provisioned: false };
  }
  if (
    !forceProvision &&
    typeof connectionConfig.cloudAccessKey === 'string' &&
    connectionConfig.cloudAccessKey.trim()
  ) {
    return { config: connectionConfig, provisioned: false };
  }

  const installationId =
    typeof connectionConfig.cloudInstallationId === 'string' &&
    connectionConfig.cloudInstallationId.length >= 32
      ? connectionConfig.cloudInstallationId
      : randomUUID();
  const client = extension.createClient({
    config: { ...connectionConfig, cloudInstallationId: installationId },
    fetch: globalThis.fetch,
  });
  if (typeof client.provisionDeviceAccess !== 'function') {
    // An already-installed pre-managed version can still be cached in the
    // Marketplace manifest. Provision through the current first-party client
    // so a normal re-index self-heals the connection instead of asking the
    // user to reinstall a tool or reveal an endpoint/key.
    const endpoint =
      process.env.LARKUP_VIDEO_INTELLIGENCE_CLOUD_ENDPOINT ??
      'https://7w1bab08jf.execute-api.eu-central-1.amazonaws.com';
    const response = await globalThis.fetch(`${endpoint}/v1/device-keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installationId }),
    });
    const provisioned = (await response.json().catch(() => ({}))) as {
      apiKey?: string;
      entitlement?: {
        plan: string;
        sourceMinutesPerMonth: number | null;
        maxConcurrentJobs: number;
        allowFullCoverage: boolean;
      };
      error?: string;
    };
    if (!response.ok || !provisioned.apiKey || !provisioned.entitlement) {
      throw new Error(
        provisioned.error || 'Could not create the managed Video Intelligence connection.',
      );
    }
    return persistManagedConnection(globalConfig, connectionConfig, installationId, {
      apiKey: provisioned.apiKey,
      entitlement: provisioned.entitlement,
    });
  }
  const provisioned = await client.provisionDeviceAccess(installationId);
  return persistManagedConnection(globalConfig, connectionConfig, installationId, provisioned);
}

async function persistManagedConnection(
  globalConfig: Awaited<ReturnType<typeof readConfig>>,
  current: Record<string, unknown>,
  installationId: string,
  provisioned: {
    apiKey: string;
    entitlement: {
      plan: string;
      sourceMinutesPerMonth: number | null;
      maxConcurrentJobs: number;
      allowFullCoverage: boolean;
    };
  },
) {
  const { forceProvisionManagedCloud: _forceProvisionManagedCloud, ...existingToolConfig } =
    globalConfig.toolConfigs?.['video-intelligence'] ?? {};
  const toolConfigs = {
    ...(globalConfig.toolConfigs ?? {}),
    'video-intelligence': {
      ...existingToolConfig,
      cloudInstallationId: installationId,
      cloudAccessKey: provisioned.apiKey,
    },
  };
  await writeConfig({ ...globalConfig, toolConfigs });
  return {
    config: { ...current, ...toolConfigs['video-intelligence'] },
    provisioned: true,
    entitlement: provisioned.entitlement,
  };
}
