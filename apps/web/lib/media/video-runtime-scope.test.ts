import { describe, expect, it } from 'vitest';
import {
  isDocumentAvailableInVideoRuntime,
  videoRuntimeScopeFromConfig,
} from './video-runtime-scope';

describe('video runtime visibility', () => {
  it('normalizes merged local runtime values into the local evidence scope', () => {
    expect(
      videoRuntimeScopeFromConfig({
        toolConfigs: { 'video-intelligence': { runtimeMode: 'local-docker' } },
      }),
    ).toBe('local');
    expect(
      videoRuntimeScopeFromConfig({
        toolConfigs: { 'video-intelligence': { runtimeMode: 'local-process' } },
      }),
    ).toBe('local');
    expect(
      videoRuntimeScopeFromConfig({
        toolConfigs: { 'video-intelligence': { runtimeMode: 'managed-cloud' } },
      }),
    ).toBe('cloud');
  });

  it('keeps scoped video evidence out of the opposite runtime', () => {
    const localVideo = { source: 'media' as const, metadata: { videoRuntimeScope: 'local' } };
    expect(isDocumentAvailableInVideoRuntime(localVideo, 'local')).toBe(true);
    expect(isDocumentAvailableInVideoRuntime(localVideo, 'cloud')).toBe(false);
  });

  it('keeps legacy media visible until it can be safely re-indexed', () => {
    const legacyVideo = { source: 'media' as const, metadata: { mediaAssetId: 'legacy-video' } };
    expect(isDocumentAvailableInVideoRuntime(legacyVideo, 'local')).toBe(true);
    expect(isDocumentAvailableInVideoRuntime(legacyVideo, 'cloud')).toBe(true);
  });

  it('never hides ordinary corpus documents when video runtime changes', () => {
    const document = { source: 'files' as const, metadata: {} };
    expect(isDocumentAvailableInVideoRuntime(document, 'local')).toBe(true);
    expect(isDocumentAvailableInVideoRuntime(document, 'cloud')).toBe(true);
  });
});
