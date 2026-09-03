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
  const visionProvider =
    explicitVisionProvider ||
    inheritedChatProvider ||
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

  const agentProvider = config.chatProvider;
  const agentApiKey =
    config.chatApiKey || (agentProvider === 'vercel_ai_gateway' ? configuredGatewayKey : undefined);
  return {
    ...toolConfig,
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
