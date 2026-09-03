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
  const configuredGatewayKey =
    (config.visionProvider === 'vercel_ai_gateway' ? config.visionApiKey : undefined) ||
    (config.chatProvider === 'vercel_ai_gateway' ? config.chatApiKey : undefined) ||
    (config.embeddingProvider === 'vercel_ai_gateway' ? config.embeddingApiKey : undefined);
  // Model credentials must come from the user's saved project configuration.
  // A server/developer environment key is intentionally never inherited.
  const visionProvider =
    (config.visionProvider && config.visionApiKey ? config.visionProvider : undefined) ||
    (config.chatProvider && config.chatApiKey ? config.chatProvider : undefined) ||
    (config.embeddingProvider && config.embeddingApiKey ? config.embeddingProvider : undefined) ||
    (configuredGatewayKey ? 'vercel_ai_gateway' : undefined);
  const visionApiKey =
    config.visionApiKey ||
    (visionProvider === config.chatProvider ? config.chatApiKey : undefined) ||
    (visionProvider === config.embeddingProvider ? config.embeddingApiKey : undefined) ||
    (visionProvider === 'vercel_ai_gateway' ? configuredGatewayKey : undefined);
  const visionModel =
    config.visionModelId ||
    (visionProvider === config.chatProvider ? config.chatModelId : undefined) ||
    (visionProvider === 'vercel_ai_gateway' && config.chatProvider === 'vercel_ai_gateway'
      ? config.chatModelId
      : undefined);

  const agentProvider = config.chatProvider || visionProvider;
  const agentApiKey =
    config.chatApiKey ||
    (agentProvider === visionProvider ? visionApiKey : undefined) ||
    (agentProvider === 'vercel_ai_gateway' ? configuredGatewayKey : undefined);
  return {
    ...toolConfig,
    larkupVisionProvider: visionProvider,
    larkupVisionApiKey: visionApiKey,
    larkupVisionModel: visionModel,
    larkupAgentProvider: agentProvider,
    larkupAgentApiKey: agentApiKey,
    larkupAgentModel:
      config.chatModelId ||
      (agentProvider === 'google' ? 'google/gemini-3.5-flash-lite' : 'openai/gpt-5-mini'),
  };
}
