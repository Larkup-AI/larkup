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
});
