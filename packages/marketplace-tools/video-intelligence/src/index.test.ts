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
});
