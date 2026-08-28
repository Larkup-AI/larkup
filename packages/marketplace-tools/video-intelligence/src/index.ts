import type { ToolExtension } from '@larkup/marketplace/extension';
import { randomUUID } from 'node:crypto';
import { VideoIntelligenceClient } from './client.js';
import { attachVideoIntelligenceAgentClient, type VideoIntelligenceAgentClient } from './agent.js';
import type { VideoRuntimeMode } from './contracts.js';
import { ensureVideoRuntime, restartVideoRuntime } from './runtime.js';

export * from './brief.js';
export * from './agent.js';
export * from './client.js';
export * from './contracts.js';
export * from './runtime.js';
export * from './ui.js';

export const TOOL_META = {
  id: 'video-intelligence',
  name: 'Video Intelligence',
  version: '0.1.0',
} as const;

/** Managed infrastructure stays an implementation detail of Larkup Cloud. */
const MANAGED_CLOUD_ENDPOINT =
  process.env.LARKUP_VIDEO_INTELLIGENCE_CLOUD_ENDPOINT ??
  'https://7w1bab08jf.execute-api.eu-central-1.amazonaws.com';

export const TOOL_EXTENSION = {
  id: TOOL_META.id,
  apiVersion: '1' as const,
  createClient: createClientFromContext,
  async ensureRuntime(context) {
    const { mode, apiKey, endpoint } = resolveClientOptions(context.config);
    const client = createClientFromContext(context);
    await ensureVideoRuntime(
      client,
      mode,
      mode === 'local-docker' ? apiKey : undefined,
      mode === 'local-docker' ? endpoint : undefined,
    );
  },
  async restartRuntime(context) {
    const { mode, apiKey, endpoint } = resolveClientOptions(context.config);
    if (mode !== 'local-docker') {
      throw new Error('Only the local Docker runtime can be restarted here.');
    }
    await restartVideoRuntime(apiKey, endpoint);
  },
  async provisionRuntime(context) {
    const current = context.config;
    if (resolveRuntimeMode(current) !== 'managed-cloud') return { config: {} };
    if (
      typeof current.cloudInstallationId === 'string' &&
      typeof current.cloudAccessKey === 'string' &&
      current.cloudAccessKey
    ) {
      return {
        config: {},
        display: {
          userId: current.cloudInstallationId,
          apiKey: `${current.cloudAccessKey.slice(0, 8)}••••${current.cloudAccessKey.slice(-4)}`,
        },
      };
    }
    const installationId =
      typeof current.cloudInstallationId === 'string' && current.cloudInstallationId.length >= 32
        ? current.cloudInstallationId
        : randomUUID();
    const client = new VideoIntelligenceClient({
      mode: 'managed-cloud',
      endpoint: MANAGED_CLOUD_ENDPOINT,
      fetch: context.fetch,
    });
    const provisioned = await client.provisionDeviceAccess(installationId);
    return {
      config: { cloudInstallationId: installationId, cloudAccessKey: provisioned.apiKey },
      display: {
        userId: installationId,
        apiKey: `${provisioned.apiKey.slice(0, 8)}••••${provisioned.apiKey.slice(-4)}`,
      },
    };
  },
} satisfies ToolExtension<VideoIntelligenceAgentClient>;

export default TOOL_EXTENSION;

function resolveRuntimeMode(config: Record<string, unknown>): VideoRuntimeMode {
  const mode = config.runtimeMode;
  // Older cloud-first installs persisted the then-internal local mode beside
  // a cloudApiKey. Preserve that connection instead of treating it as a new
  // local Docker selection after this manifest gained real runtime choices.
  if (
    mode === 'local-docker' &&
    typeof config.cloudApiKey === 'string' &&
    config.cloudApiKey.trim() &&
    !config.localRuntimeUrl &&
    !config.localRuntimeApiKey
  )
    return 'managed-cloud';
  return mode === 'local-docker' || mode === 'custom-remote' || mode === 'managed-cloud'
    ? mode
    : 'managed-cloud';
}

function resolveClientOptions(config: Record<string, unknown>) {
  const legacyCloudAccessKey =
    typeof config.cloudApiKey === 'string' && config.cloudApiKey.trim()
      ? config.cloudApiKey
      : undefined;
  const mode = resolveRuntimeMode(config);
  const endpoint =
    mode === 'managed-cloud'
      ? MANAGED_CLOUD_ENDPOINT
      : mode === 'local-docker'
      ? typeof config.localRuntimeUrl === 'string' && config.localRuntimeUrl.trim()
        ? config.localRuntimeUrl
        : 'http://127.0.0.1:8787'
      : typeof config.customRuntimeUrl === 'string'
      ? config.customRuntimeUrl
      : '';
  return {
    mode,
    endpoint,
    apiKey:
      mode === 'managed-cloud'
        ? typeof config.cloudAccessKey === 'string'
          ? config.cloudAccessKey
          : legacyCloudAccessKey
        : mode === 'local-docker'
        ? typeof config.localRuntimeApiKey === 'string'
          ? config.localRuntimeApiKey
          : undefined
        : typeof config.customRuntimeApiKey === 'string'
        ? config.customRuntimeApiKey
        : undefined,
  };
}

function createClientFromContext(context: {
  config: Record<string, unknown>;
  fetch?: typeof globalThis.fetch;
}) {
  const { mode, endpoint, apiKey } = resolveClientOptions(context.config);
  return attachVideoIntelligenceAgentClient(
    new VideoIntelligenceClient({ mode, endpoint, apiKey, fetch: context.fetch }),
    context.fetch,
  );
}
