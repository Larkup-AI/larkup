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
  name: 'Video Intelligence (New)',
  version: '0.1.0',
} as const;

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
  const mode = String(config.runtimeMode ?? 'local-docker') as
    | 'local-docker'
    | 'managed-cloud'
    | 'custom-remote';
  return {
    mode,
    endpoint:
      mode === 'local-docker'
        ? String(config.localEndpoint ?? 'http://127.0.0.1:8787')
        : String(config.cloudEndpoint ?? ''),
    apiKey: typeof config.cloudApiKey === 'string' ? config.cloudApiKey : undefined,
  };
}

function createClientFromContext(context: {
  config: Record<string, unknown>;
  fetch?: typeof globalThis.fetch;
}) {
  const { mode, endpoint, apiKey } = resolveClientOptions(context.config);
  return new VideoIntelligenceClient({ mode, endpoint, apiKey, fetch: context.fetch });
}
