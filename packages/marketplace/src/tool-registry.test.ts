import { describe, expect, it } from 'vitest';
import { buildRegistry, compareToolVersions, invalidateRegistryCache } from './tool-registry';

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

describe('tool version comparison', () => {
  it('does not let a stale catalog version outrank a newer installed release', () => {
    expect(compareToolVersions('0.2.9', '0.2.8')).toBeGreaterThan(0);
    expect(compareToolVersions('0.2.8', '0.2.9')).toBeLessThan(0);
  });
});
