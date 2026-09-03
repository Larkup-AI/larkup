import { describe, expect, it } from 'vitest';
import { videoUnderstandingEnvironment } from './runtime';

describe('videoUnderstandingEnvironment', () => {
  it('keeps local semantic vision off without a user-selected provider key', () => {
    const environment = videoUnderstandingEnvironment({
      visionProvider: 'vercel_ai_gateway',
      semanticVisionModel: 'google/gemini-3.6-flash',
    });

    expect(environment.LARKUP_VIDEO_SEMANTIC_VISION).toBe('false');
    expect(environment.LARKUP_VIDEO_VISION_API_KEY).toBe('');
    expect(environment.AI_GATEWAY_API_KEY).toBe('');
  });

  it('uses the user-selected direct vision provider without selecting managed compute', () => {
    const environment = videoUnderstandingEnvironment({
      visionProvider: 'vercel_ai_gateway',
      visionApiKey: 'user-owned-key',
      semanticVisionModel: 'google/gemini-3.6-flash',
      agentProvider: 'openai',
      agentApiKey: 'agent-key',
      agentModel: 'openai/gpt-5-mini',
      audioProvider: 'deepgram',
      audioApiKey: 'user-owned-audio-key',
      audioModel: 'nova-3',
    });

    expect(environment).toMatchObject({
      LARKUP_VIDEO_SEMANTIC_VISION: 'true',
      LARKUP_VIDEO_VISION_PROVIDER: 'vercel_ai_gateway',
      LARKUP_VIDEO_VISION_API_KEY: 'user-owned-key',
      LARKUP_VIDEO_AGENT_ENABLED: 'true',
      LARKUP_VIDEO_AGENT_PROVIDER: 'openai',
      LARKUP_VIDEO_AGENT_API_KEY: 'agent-key',
      LARKUP_VIDEO_AGENT_MODEL: 'openai/gpt-5-mini',
      AI_GATEWAY_API_KEY: 'user-owned-key',
      LARKUP_VIDEO_TRANSCRIPTION_PROVIDER: 'deepgram',
      LARKUP_VIDEO_TRANSCRIPTION_FALLBACK: '',
      LARKUP_VIDEO_DEEPGRAM_MODEL: 'nova-3',
      DEEPGRAM_API_KEY: 'user-owned-audio-key',
      LARKUP_VIDEO_EMBEDDING_PROVIDER: 'gateway-gemini-embedding-2',
    });
    expect(environment).not.toHaveProperty('MODAL_TOKEN_ID');
    expect(environment).not.toHaveProperty('RUNPOD_API_KEY');
  });

  it('preserves an explicit decision to disable video embeddings', () => {
    const environment = videoUnderstandingEnvironment({
      visionProvider: 'vercel_ai_gateway',
      visionApiKey: 'user-owned-key',
      videoEmbeddingProvider: 'disabled',
    });

    expect(environment.LARKUP_VIDEO_EMBEDDING_PROVIDER).toBe('disabled');
  });

  it('passes a direct Google key only to the local runtime vision client', () => {
    const environment = videoUnderstandingEnvironment({
      visionProvider: 'google',
      visionApiKey: 'google-user-key',
      semanticVisionModel: 'gemini-3.6-flash',
    });

    expect(environment).toMatchObject({
      LARKUP_VIDEO_SEMANTIC_VISION: 'true',
      LARKUP_VIDEO_VISION_PROVIDER: 'google',
      LARKUP_VIDEO_VISION_API_KEY: 'google-user-key',
      LARKUP_VIDEO_SEMANTIC_VISION_MODEL: 'gemini-3.6-flash',
      AI_GATEWAY_API_KEY: '',
    });
  });
});
