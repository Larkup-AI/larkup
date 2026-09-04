import { describe, expect, it } from 'vitest';
import { buildRegistry, invalidateRegistryCache } from './tool-registry';

describe('tool registry fallback catalog', () => {
  it('keeps Video Intelligence installable when a remote catalog is stale or incomplete', async () => {
    invalidateRegistryCache();
    const registry = await buildRegistry({ skipHub: true });

    expect(registry['video-intelligence']).toMatchObject({
      id: 'video-intelligence',
      packageName: '@larkup/tool-video-intelligence',
      version: expect.any(String),
    });
  });
});
