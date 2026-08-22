import type { ToolExtension } from '@larkup/marketplace/extension';
import { VideoIntelligenceClient } from './client.js';
import { ensureVideoRuntime } from './runtime.js';

export * from './brief.js';
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
    const { mode } = resolveClientOptions(context.config);
    const client = createClientFromContext(context);
    await ensureVideoRuntime(client, mode);
  },
} satisfies ToolExtension<VideoIntelligenceClient>;

export default TOOL_EXTENSION;

function resolveClientOptions(config: Record<string, unknown>) {
  const legacyCloudAccessKey =
    typeof config.cloudApiKey === 'string' && config.cloudApiKey.trim()
      ? config.cloudApiKey
      : undefined;
  // The installed product is cloud-first: the provider endpoint is private
  // control-plane configuration and is never a user setting. Retain the
  // low-level client modes only for self-hosted/runtime development APIs.
  const mode = 'managed-cloud' as const;
  return {
    mode,
    endpoint: MANAGED_CLOUD_ENDPOINT,
    apiKey:
      typeof config.cloudAccessKey === 'string' ? config.cloudAccessKey : legacyCloudAccessKey,
  };
}

function createClientFromContext(context: {
  config: Record<string, unknown>;
  fetch?: typeof globalThis.fetch;
}) {
  const { mode, endpoint, apiKey } = resolveClientOptions(context.config);
  return new VideoIntelligenceClient({ mode, endpoint, apiKey, fetch: context.fetch });
}
