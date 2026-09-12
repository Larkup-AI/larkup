import { describe, expect, it } from 'vitest';
import { getProviderEmbedUrl } from '../../components/chat/tools/chat-media-preview';

describe('getProviderEmbedUrl', () => {
  it('uses YouTube’s browser-supported player with the cited range', () => {
    expect(getProviderEmbedUrl('https://www.youtube.com/watch?v=video-id', 81, 117)).toBe(
      'https://www.youtube-nocookie.com/embed/video-id?start=81&rel=0&end=117',
    );
  });

  it('does not convert a local media endpoint into a provider embed', () => {
    expect(getProviderEmbedUrl('/api/media/asset-1', 81, 117)).toBeUndefined();
  });
});
