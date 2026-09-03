import { describe, expect, it, vi } from 'vitest';
import { TOOL_EXTENSION } from './index';

describe('Video Intelligence configuration verification', () => {
  it('verifies the tool-selected vision model without changing global AI settings', async () => {
    const request = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ choices: [{}] }), { status: 200 }));

    await TOOL_EXTENSION.verifyConfiguration?.({
      verifyKey: 'semanticVisionModel',
      fetch: request,
      config: {
        runtimeMode: 'local',
        videoVisionProvider: 'vercel_ai_gateway',
        videoVisionApiKey: 'tool-only-key',
        semanticVisionModel: 'google/gemini-3.6-flash',
        visionProvider: 'openai',
        visionModelId: 'gpt-4o-mini',
      },
    });

    expect(request).toHaveBeenCalledWith(
      'https://ai-gateway.vercel.sh/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('google/gemini-3.6-flash'),
      }),
    );
  });
});
