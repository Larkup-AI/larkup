import type { RagConfig } from '@larkup/core/types';

/**
 * Supplies a marketplace runtime with the user's selected AI Models settings
 * without making the installed package import the host application's source.
 */
export function withGlobalVisionGatewayConfig(
  toolConfig: Record<string, unknown>,
  config: Pick<
    RagConfig,
    | 'visionProvider'
    | 'visionApiKey'
    | 'visionModelId'
    | 'chatProvider'
    | 'chatApiKey'
    | 'chatModelId'
    | 'embeddingProvider'
    | 'embeddingApiKey'
  >,
): Record<string, unknown> {
  const visionCapableProviders = new Set(['vercel_ai_gateway', 'openai', 'google']);
  const toolConfigWithCurrentDefaults = migrateLegacyVideoIntelligenceDefaults(toolConfig, config);
  const configuredGatewayKey =
    (config.visionProvider === 'vercel_ai_gateway' ? config.visionApiKey : undefined) ||
    (config.chatProvider === 'vercel_ai_gateway' ? config.chatApiKey : undefined) ||
    (config.embeddingProvider === 'vercel_ai_gateway' ? config.embeddingApiKey : undefined);
  // Model credentials must come from the user's saved project configuration.
  // A server/developer environment key is intentionally never inherited.
  const explicitVisionProvider =
    config.visionProvider &&
    config.visionApiKey &&
    visionCapableProviders.has(config.visionProvider)
      ? config.visionProvider
      : undefined;
  const inheritedChatProvider =
    config.chatProvider && config.chatApiKey && visionCapableProviders.has(config.chatProvider)
      ? config.chatProvider
      : undefined;
  const inheritedEmbeddingProvider =
    config.embeddingProvider &&
    config.embeddingApiKey &&
    visionCapableProviders.has(config.embeddingProvider)
      ? config.embeddingProvider
      : undefined;
  const visionProvider =
    explicitVisionProvider ||
    inheritedChatProvider ||
    inheritedEmbeddingProvider ||
    (configuredGatewayKey ? 'vercel_ai_gateway' : undefined);
  const visionApiKey =
    (explicitVisionProvider ? config.visionApiKey : undefined) ||
    (visionProvider === config.chatProvider ? config.chatApiKey : undefined) ||
    (visionProvider === config.embeddingProvider ? config.embeddingApiKey : undefined) ||
    (visionProvider === 'vercel_ai_gateway' ? configuredGatewayKey : undefined);
  const visionModel =
    (explicitVisionProvider ? config.visionModelId : undefined) ||
    (inheritedChatProvider && inheritedChatProvider === visionProvider
      ? config.chatModelId
      : undefined) ||
    (visionProvider === 'vercel_ai_gateway' && config.chatProvider === 'vercel_ai_gateway'
      ? config.chatModelId
      : undefined);

  // Older projects commonly have one OpenAI key saved with the embedding
  // configuration before a separate Chat Model was introduced. Reuse it when
  // it belongs to a provider that can run the video tool's planning pass.
  const agentProvider =
    (config.chatProvider && config.chatApiKey ? config.chatProvider : undefined) ||
    (config.embeddingProvider &&
    config.embeddingApiKey &&
    visionCapableProviders.has(config.embeddingProvider)
      ? config.embeddingProvider
      : config.chatProvider);
  const agentApiKey =
    (agentProvider === config.chatProvider ? config.chatApiKey : undefined) ||
    (agentProvider === config.embeddingProvider ? config.embeddingApiKey : undefined) ||
    (agentProvider === 'vercel_ai_gateway' ? configuredGatewayKey : undefined);
  return {
    ...toolConfigWithCurrentDefaults,
    larkupVisionProvider: visionProvider,
    larkupVisionApiKey: visionApiKey,
    larkupVisionModel: visionModel,
    larkupAgentProvider: agentProvider,
    larkupAgentApiKey: agentApiKey,
    larkupAgentModel:
      config.chatModelId ||
      (agentProvider === 'google'
        ? 'google/gemini-3.5-flash-lite'
        : agentProvider === 'openai'
          ? 'openai/gpt-5-mini'
          : undefined),
  };
}

/**
 * Versions through 0.2.4 persisted provider-specific values that were meant
 * to be defaults. Those values shadow AI Models forever, so an existing
 * OpenAI setup can look unconfigured after installing Video Intelligence.
 * Treat only the exact old, keyless defaults as automatic. Real overrides and
 * Gateway-based AI Models selections remain untouched.
 */
function migrateLegacyVideoIntelligenceDefaults(
  toolConfig: Record<string, unknown>,
  config: Pick<
    RagConfig,
    | 'visionProvider'
    | 'visionApiKey'
    | 'chatProvider'
    | 'chatApiKey'
    | 'embeddingProvider'
    | 'embeddingApiKey'
  >,
): Record<string, unknown> {
  if (!('videoVisionProvider' in toolConfig) && !('videoAgentProvider' in toolConfig)) {
    return toolConfig;
  }

  const value = (key: string) =>
    typeof toolConfig[key] === 'string' ? toolConfig[key].trim() : undefined;
  const hasSavedVisionDefault = Boolean(
    (config.visionProvider && config.visionApiKey) ||
    (config.chatProvider && config.chatApiKey) ||
    (config.embeddingProvider && config.embeddingApiKey),
  );
  const hasSavedAgentDefault = Boolean(
    (config.chatProvider && config.chatApiKey) ||
    (config.embeddingProvider && config.embeddingApiKey),
  );
  const usesSavedGateway =
    config.visionProvider === 'vercel_ai_gateway' || config.chatProvider === 'vercel_ai_gateway';
  const migrated = { ...toolConfig };

  if (
    hasSavedVisionDefault &&
    !usesSavedGateway &&
    value('videoVisionProvider') === 'vercel_ai_gateway' &&
    !value('videoVisionApiKey') &&
    value('semanticVisionModel') === 'google/gemini-3.6-flash'
  ) {
    migrated.videoVisionProvider = 'auto';
    migrated.semanticVisionModel = 'auto';
  }
  if (
    hasSavedAgentDefault &&
    config.chatProvider !== 'vercel_ai_gateway' &&
    config.embeddingProvider !== 'vercel_ai_gateway' &&
    value('videoAgentProvider') === 'vercel_ai_gateway' &&
    !value('videoAgentApiKey') &&
    value('agentModel') === 'openai/gpt-5-mini'
  ) {
    migrated.videoAgentProvider = 'auto';
    migrated.agentModel = 'auto';
  }
  return migrated;
}
