import { describe, expect, it, vi } from 'vitest';
import { TOOL_EXTENSION } from './index';

describe('Video Intelligence configuration verification', () => {
  it('verifies an audio provider without requiring a user-selected audio model', async () => {
    const request = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ projects: [] }), { status: 200 }));

    await TOOL_EXTENSION.verifyConfiguration?.({
      verifyKey: 'audioApiKey',
      fetch: request,
      config: {
        runtimeMode: 'local',
        audioProvider: 'deepgram',
        audioApiKey: 'user-audio-key',
      },
    });

    expect(request).toHaveBeenCalledWith(
      'https://api.deepgram.com/v1/projects',
      expect.objectContaining({
        headers: { Authorization: 'Token user-audio-key' },
      }),
    );
  });

  it('verifies a tool-specific DeepSeek brain override instead of the AI Models default', async () => {
    const request = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ choices: [] }), { status: 200 }));

    await TOOL_EXTENSION.verifyConfiguration?.({
      verifyKey: 'agentModel',
      fetch: request,
      config: {
        larkupAgentProvider: 'google',
        larkupAgentApiKey: 'global-google-key',
        larkupAgentModel: 'google/gemini-3.6-flash',
        videoAgentProvider: 'deepseek',
        videoAgentApiKey: 'tool-deepseek-key',
        agentModel: 'deepseek/deepseek-v3.2',
      },
    });

    expect(request).toHaveBeenCalledWith(
      'https://api.deepseek.com/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer tool-deepseek-key' }),
        body: expect.stringContaining('"model":"deepseek-v3.2"'),
      }),
    );
  });
});
