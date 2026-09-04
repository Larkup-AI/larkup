import { describe, expect, it } from 'vitest';
import { withGlobalVisionGatewayConfig } from './tool-runtime-config';

describe('withGlobalVisionGatewayConfig', () => {
  it('does not inherit an operator AI Gateway environment secret', () => {
    process.env.AI_GATEWAY_API_KEY = 'gateway-from-environment';

    expect(
      withGlobalVisionGatewayConfig(
        {},
        {
          visionProvider: 'vercel_ai_gateway',
          visionApiKey: '',
          visionModelId: 'google/gemini-3.6-flash',
          chatProvider: 'vercel_ai_gateway',
          chatApiKey: '',
          chatModelId: '',
          embeddingProvider: 'openai',
          embeddingApiKey: '',
        },
      ),
    ).toMatchObject({ larkupVisionApiKey: undefined, larkupAgentApiKey: undefined });
    delete process.env.AI_GATEWAY_API_KEY;
  });

  it('keeps the selected tool-brain provider and model independent from vision', () => {
    expect(
      withGlobalVisionGatewayConfig(
        {
          videoVisionProvider: 'google',
          videoVisionApiKey: 'vision-key',
          semanticVisionModel: 'google/gemini-3.6-flash',
          videoAgentProvider: 'openai',
          videoAgentApiKey: 'agent-key',
          agentModel: 'openai/gpt-5-mini',
        },
        {
          visionProvider: 'google',
          visionApiKey: 'global-vision-key',
          visionModelId: 'google/gemini-3.6-flash',
          chatProvider: 'openai',
          chatApiKey: 'global-agent-key',
          chatModelId: 'openai/gpt-5.2',
          embeddingProvider: 'openai',
          embeddingApiKey: '',
        },
      ),
    ).toMatchObject({
      larkupVisionProvider: 'google',
      larkupVisionApiKey: 'global-vision-key',
      larkupVisionModel: 'google/gemini-3.6-flash',
      videoVisionProvider: 'google',
      videoVisionApiKey: 'vision-key',
      semanticVisionModel: 'google/gemini-3.6-flash',
      larkupAgentProvider: 'openai',
      larkupAgentApiKey: 'global-agent-key',
      larkupAgentModel: 'openai/gpt-5.2',
      videoAgentProvider: 'openai',
      videoAgentApiKey: 'agent-key',
      agentModel: 'openai/gpt-5-mini',
    });
  });

  it('leaves video model credentials unconfigured when the user saved none', () => {
    process.env.AI_GATEWAY_API_KEY = 'gateway-from-environment';

    expect(
      withGlobalVisionGatewayConfig(
        {},
        {
          visionProvider: '',
          visionApiKey: '',
          visionModelId: '',
          chatProvider: '',
          chatApiKey: '',
          chatModelId: '',
          embeddingProvider: 'openai',
          embeddingApiKey: '',
        },
      ),
    ).toMatchObject({ larkupVisionProvider: undefined, larkupVisionApiKey: undefined });
    delete process.env.AI_GATEWAY_API_KEY;
  });

  it('does not treat a text-only DeepSeek chat provider as the vision provider', () => {
    expect(
      withGlobalVisionGatewayConfig(
        {},
        {
          visionProvider: '',
          visionApiKey: '',
          visionModelId: '',
          chatProvider: 'deepseek',
          chatApiKey: 'deepseek-key',
          chatModelId: 'deepseek/deepseek-v4-pro',
          embeddingProvider: 'openai',
          embeddingApiKey: '',
        },
      ),
    ).toMatchObject({
      larkupAgentProvider: 'deepseek',
      larkupAgentApiKey: 'deepseek-key',
      larkupAgentModel: 'deepseek/deepseek-v4-pro',
      larkupVisionProvider: undefined,
      larkupVisionApiKey: undefined,
      larkupVisionModel: undefined,
    });
  });

  it('ignores a saved DeepSeek vision selection because it is text-only', () => {
    expect(
      withGlobalVisionGatewayConfig(
        {},
        {
          visionProvider: 'deepseek',
          visionApiKey: 'deepseek-key',
          visionModelId: 'deepseek/deepseek-v4-pro',
          chatProvider: 'deepseek',
          chatApiKey: 'deepseek-key',
          chatModelId: 'deepseek/deepseek-v4-pro',
          embeddingProvider: 'openai',
          embeddingApiKey: '',
        },
      ),
    ).toMatchObject({
      larkupAgentProvider: 'deepseek',
      larkupAgentApiKey: 'deepseek-key',
      larkupVisionProvider: undefined,
      larkupVisionApiKey: undefined,
      larkupVisionModel: undefined,
    });
  });

  it('reuses one vision-capable chat provider and key automatically', () => {
    expect(
      withGlobalVisionGatewayConfig(
        {},
        {
          visionProvider: '',
          visionApiKey: '',
          visionModelId: '',
          chatProvider: 'google',
          chatApiKey: 'google-key',
          chatModelId: 'google/gemini-3.6-flash',
          embeddingProvider: 'openai',
          embeddingApiKey: '',
        },
      ),
    ).toMatchObject({
      larkupAgentProvider: 'google',
      larkupAgentApiKey: 'google-key',
      larkupVisionProvider: 'google',
      larkupVisionApiKey: 'google-key',
      larkupVisionModel: 'google/gemini-3.6-flash',
    });
  });

  it('migrates the old keyless Video Intelligence defaults to saved OpenAI settings', () => {
    expect(
      withGlobalVisionGatewayConfig(
        {
          videoVisionProvider: 'vercel_ai_gateway',
          semanticVisionModel: 'google/gemini-3.6-flash',
          videoAgentProvider: 'vercel_ai_gateway',
          agentModel: 'openai/gpt-5-mini',
        },
        {
          visionProvider: '',
          visionApiKey: '',
          visionModelId: '',
          chatProvider: 'openai',
          chatApiKey: 'openai-key',
          chatModelId: 'openai/gpt-5-mini',
          embeddingProvider: 'openai',
          embeddingApiKey: 'embedding-key',
        },
      ),
    ).toMatchObject({
      videoVisionProvider: 'auto',
      semanticVisionModel: 'auto',
      videoAgentProvider: 'auto',
      agentModel: 'auto',
      larkupVisionProvider: 'openai',
      larkupVisionApiKey: 'openai-key',
      larkupAgentProvider: 'openai',
      larkupAgentApiKey: 'openai-key',
    });
  });

  it('uses a compatible saved embedding key when no chat key has been configured yet', () => {
    expect(
      withGlobalVisionGatewayConfig(
        {
          videoVisionProvider: 'vercel_ai_gateway',
          semanticVisionModel: 'google/gemini-3.6-flash',
          videoAgentProvider: 'vercel_ai_gateway',
          agentModel: 'openai/gpt-5-mini',
        },
        {
          visionProvider: '',
          visionApiKey: '',
          visionModelId: '',
          chatProvider: '',
          chatApiKey: '',
          chatModelId: '',
          embeddingProvider: 'openai',
          embeddingApiKey: 'openai-key',
        },
      ),
    ).toMatchObject({
      larkupVisionProvider: 'openai',
      larkupVisionApiKey: 'openai-key',
      larkupAgentProvider: 'openai',
      larkupAgentApiKey: 'openai-key',
    });
  });
});
