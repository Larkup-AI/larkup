import type { ToolExtension } from '@larkup/marketplace/extension';
import { randomUUID } from 'node:crypto';
import { VideoIntelligenceClient } from './client.js';
import { attachVideoIntelligenceAgentClient, type VideoIntelligenceAgentClient } from './agent.js';
import type { LocalVideoRuntimeKind, VideoRuntimeMode } from './contracts.js';
import {
  detectLocalRuntimeHost,
  ensureVideoRuntime,
  installLocalRuntime,
  removeVideoRuntime,
  restartVideoRuntime,
  stopVideoRuntime,
  type VideoUnderstandingEnvConfig,
} from './runtime.js';

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
    if (mode === 'local') {
      const kind = await resolveLocalKind();
      const understanding = await resolveUnderstandingConfig(context.config);
      await ensureVideoRuntime(client, kind, apiKey, endpoint, understanding);
      return;
    }
    await ensureVideoRuntime(client, mode, undefined, undefined);
  },
  async restartRuntime(context) {
    const { mode, apiKey, endpoint } = resolveClientOptions(context.config);
    if (mode !== 'local') {
      throw new Error('Only a local runtime can be restarted here.');
    }
    const kind = await resolveLocalKind();
    const understanding = await resolveUnderstandingConfig(context.config);
    await restartVideoRuntime(kind, apiKey, endpoint, understanding);
  },
  /** Pulls the Docker image or installs uv + syncs Python deps, without starting anything. */
  async installRuntime(context) {
    const { mode, apiKey, endpoint } = resolveClientOptions(context.config);
    if (mode !== 'local') {
      throw new Error('Only a local runtime can be installed here.');
    }
    const kind = await resolveLocalKind();
    const understanding = await resolveUnderstandingConfig(context.config);
    await installLocalRuntime(kind, apiKey, endpoint, understanding);
  },
  async stopRuntime(context) {
    const { mode } = resolveClientOptions(context.config);
    if (mode !== 'local') {
      throw new Error('Only a local runtime can be stopped here.');
    }
    await stopVideoRuntime();
    const client = createClientFromContext(context);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        await client.health();
      } catch {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(
      'The local runtime is still responding after stop. Check for another process using its URL.',
    );
  },
  async verifyConfiguration(context) {
    if (context.verifyKey === 'localRuntimeUrl' || context.verifyKey === 'customRuntimeUrl') {
      await createClientFromContext(context).health();
      return;
    }
    const understanding = await resolveUnderstandingConfig(context.config);
    if (context.verifyKey === 'semanticVisionModel') {
      await verifyProviderModel(
        'Video vision',
        understanding.visionProvider,
        understanding.visionApiKey,
        understanding.semanticVisionModel,
        context.fetch,
      );
      return;
    }
    if (context.verifyKey === 'agentModel') {
      await verifyProviderModel(
        'Agent planning',
        understanding.agentProvider,
        understanding.agentApiKey,
        understanding.agentModel,
        context.fetch,
      );
      return;
    }
    if (context.verifyKey === 'audioApiKey') {
      await verifyAudioProvider(
        understanding.audioProvider,
        understanding.audioApiKey,
        understanding.audioModel,
        context.fetch,
      );
      return;
    }
    throw new Error('This Video Intelligence setting cannot be verified.');
  },
  async removeRuntime(context) {
    const { mode } = resolveClientOptions(context.config);
    if (mode !== 'local') return;
    await removeVideoRuntime(await resolveLocalKind());
  },
  /** Docker/native detection, system suitability, and AI-model availability for the Install alert. */
  async getHostCapabilities(context) {
    const [host, understanding] = await Promise.all([
      detectLocalRuntimeHost(),
      resolveUnderstandingConfig(context.config),
    ]);
    const selectedModel = understanding.semanticVisionModel ?? 'google/gemini-3.6-flash';
    const hasVisionKey = Boolean(understanding.visionApiKey);
    const modelIsVideoCapable = /gemini.*flash|gemini.*vision|qwen.*vl|gpt-4o|gpt-4\.1/i.test(
      selectedModel,
    );
    const modelRequirement = !hasVisionKey
      ? {
          configured: false,
          message:
            'Video understanding needs a vision-capable provider and API key in Settings → AI Models. Text-only chat providers such as DeepSeek need a separate Vision Model.',
        }
      : !modelIsVideoCapable
        ? {
            configured: false,
            message: `${selectedModel} is not a recommended video vision model. Use Gemini Flash or a Qwen-VL model before indexing video.`,
          }
        : {
            configured: true,
            provider: understanding.visionProvider,
            model: selectedModel,
            message: `Video understanding will use ${selectedModel}, loaded automatically from AI Models.`,
          };
    let running = false;
    try {
      await createClientFromContext(context).health();
      running = true;
    } catch {
      // Health is only a status probe. Never start a runtime while rendering settings.
    }
    return {
      ...host,
      running,
      gatewayKeyAvailable: hasVisionKey,
      gatewayKeySource: hasVisionKey ? 'global' : null,
      modelRequirement,
    };
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
        display: { userId: current.cloudInstallationId },
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
      display: { userId: installationId },
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
  // 'local-docker'/'local-process' were the user-facing choices before the two
  // local runtimes were merged into one auto-detected 'local' mode. Treat both
  // as synonyms for 'local' so existing installs keep working with zero migration.
  if (mode === 'local-docker' || mode === 'local-process' || mode === 'local') return 'local';
  return mode === 'custom-remote' || mode === 'managed-cloud' ? mode : 'managed-cloud';
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
      : mode === 'local'
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
        : mode === 'local'
          ? typeof config.localRuntimeApiKey === 'string'
            ? config.localRuntimeApiKey
            : undefined
          : typeof config.customRuntimeApiKey === 'string'
            ? config.customRuntimeApiKey
            : undefined,
  };
}

/** Resolves 'local' to a concrete kind right before an action executes — never persisted. */
async function resolveLocalKind(): Promise<LocalVideoRuntimeKind> {
  const report = await detectLocalRuntimeHost();
  return report.recommendedKind ?? 'local-process';
}

/**
 * Builds the local runtime's video-understanding environment. The host passes
 * the selected AI Models settings in this context, keeping a
 * marketplace tool independent from the host application's source modules.
 */
async function resolveUnderstandingConfig(
  config: Record<string, unknown>,
): Promise<VideoUnderstandingEnvConfig> {
  const str = (value: unknown) => (typeof value === 'string' && value.trim() ? value : undefined);
  const visionProvider = str(config.larkupVisionProvider) ?? 'vercel_ai_gateway';
  const visionApiKey = str(config.larkupVisionApiKey) ?? str(config.larkupGatewayApiKey);
  let semanticVisionModel = str(config.larkupVisionModel) ?? str(config.larkupGatewayVisionModel);
  if (!semanticVisionModel) {
    semanticVisionModel =
      visionProvider === 'google'
        ? 'gemini-3.6-flash'
        : visionProvider === 'openai'
          ? 'gpt-4o-mini'
          : 'google/gemini-3.6-flash';
  }
  const agentProvider = str(config.larkupAgentProvider) ?? 'vercel_ai_gateway';
  const agentApiKey =
    str(config.larkupAgentApiKey) ?? (agentProvider === visionProvider ? visionApiKey : undefined);
  const agentModel =
    str(config.larkupAgentModel) ??
    (agentProvider === 'google' ? 'google/gemini-3.5-flash-lite' : 'openai/gpt-5-mini');
  return {
    visionProvider,
    visionApiKey,
    semanticVisionModel,
    agentProvider,
    agentApiKey,
    agentModel,
    audioProvider: str(config.audioProvider),
    audioApiKey: str(config.audioApiKey),
    audioModel: {
      openai: 'whisper-1',
      groq: 'whisper-large-v3-turbo',
      deepgram: 'nova-3',
      elevenlabs: 'scribe_v2',
    }[str(config.audioProvider) ?? ''] as string | undefined,
    videoEmbeddingProvider: str(config.videoEmbeddingProvider),
    dashscopeApiKey: str(config.dashscopeApiKey),
    dashscopeWorkspaceId: str(config.dashscopeWorkspaceId),
    dashscopeRegion: str(config.dashscopeRegion),
    runpodEmbeddingApiKey: str(config.runpodEmbeddingApiKey),
    runpodEmbeddingEndpointId: str(config.runpodEmbeddingEndpointId),
    hfEmbeddingUrl: str(config.hfEmbeddingUrl),
    hfEmbeddingApiKey: str(config.hfEmbeddingApiKey),
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

async function verifyProviderModel(
  label: string,
  provider: string | undefined,
  apiKey: string | undefined,
  model: string | undefined,
  request = globalThis.fetch,
) {
  if (!provider || !apiKey || !model) {
    throw new Error(`${label} needs a provider, model, and API key before it can be verified.`);
  }
  const normalizedProvider = provider.trim().toLowerCase();
  const normalizedModel = model.replace(/^(google|openai)\//, '');
  let response: Response;
  if (normalizedProvider === 'google') {
    response = await request(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        normalizedModel,
      )}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Reply with OK.' }] }],
          generationConfig: { maxOutputTokens: 8 },
        }),
      },
    );
  } else if (normalizedProvider === 'openai' || normalizedProvider === 'vercel_ai_gateway') {
    const baseUrl =
      normalizedProvider === 'openai'
        ? 'https://api.openai.com/v1'
        : 'https://ai-gateway.vercel.sh/v1';
    response = await request(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: normalizedProvider === 'openai' ? normalizedModel : model,
        messages: [{ role: 'user', content: 'Reply with OK.' }],
        max_tokens: 8,
      }),
    });
  } else {
    throw new Error(`${label} provider "${provider}" is not supported.`);
  }
  if (response.ok) return;
  const body = await response.json().catch(() => ({}));
  const detail =
    body && typeof body === 'object' && 'error' in body
      ? typeof body.error === 'string'
        ? body.error
        : body.error && typeof body.error === 'object' && 'message' in body.error
          ? String(body.error.message)
          : undefined
      : undefined;
  throw new Error(
    detail ? `${label} verification failed: ${detail}` : `${label} verification failed.`,
  );
}

async function verifyAudioProvider(
  provider: string | undefined,
  apiKey: string | undefined,
  model: string | undefined,
  request = globalThis.fetch,
) {
  if (!provider || !apiKey || !model) {
    throw new Error('Audio transcription needs a provider and API key before it can be verified.');
  }
  const normalized = provider.trim().toLowerCase();
  const target =
    normalized === 'openai'
      ? `https://api.openai.com/v1/models/${encodeURIComponent(model)}`
      : normalized === 'groq'
        ? `https://api.groq.com/openai/v1/models/${encodeURIComponent(model)}`
        : normalized === 'deepgram'
          ? 'https://api.deepgram.com/v1/projects'
          : normalized === 'elevenlabs'
            ? 'https://api.elevenlabs.io/v1/user'
            : '';
  if (!target) throw new Error(`Audio provider "${provider}" is not supported.`);
  const response = await request(target, {
    headers:
      normalized === 'deepgram'
        ? { Authorization: `Token ${apiKey}` }
        : normalized === 'elevenlabs'
          ? { 'xi-api-key': apiKey }
          : { Authorization: `Bearer ${apiKey}` },
  });
  if (response.ok) return;
  const body = await response.json().catch(() => ({}));
  const detail =
    body && typeof body === 'object' && 'error' in body
      ? typeof body.error === 'string'
        ? body.error
        : body.error && typeof body.error === 'object' && 'message' in body.error
          ? String(body.error.message)
          : undefined
      : undefined;
  throw new Error(detail ? `Audio verification failed: ${detail}` : 'Audio verification failed.');
}
