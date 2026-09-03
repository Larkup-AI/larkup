import { describe, expect, it } from 'vitest';
import { selectedRemoteDuration, selectedRemoteUrls } from './source-selection';

describe('remote media source selection', () => {
  const playlistUrl = 'https://www.youtube.com/watch?v=chosen-video&list=long-playlist&index=16';
  const estimates = [
    {
      originalUrl: playlistUrl,
      durationSecs: 87_540,
      singleItemDurationSecs: 3_600,
      singleItemUrl: 'https://www.youtube.com/watch?v=chosen-video',
      entryCount: 24,
    },
  ];

  it('uses only the chosen video duration for a single-video import', () => {
    expect(selectedRemoteDuration(estimates, true)).toBe(3_600);
    expect(selectedRemoteDuration(estimates, false)).toBe(87_540);
  });

  it('never substitutes a playlist total when one item has no duration yet', () => {
    expect(
      selectedRemoteDuration(
        [{ originalUrl: playlistUrl, durationSecs: 87_540, entryCount: 24 }],
        true,
      ),
    ).toBe(0);
  });

  it('imports the inspected video rather than its playlist', () => {
    expect(selectedRemoteUrls([playlistUrl], estimates, true)).toEqual([
      'https://www.youtube.com/watch?v=chosen-video',
    ]);
    expect(selectedRemoteUrls([playlistUrl], estimates, false)).toEqual([playlistUrl]);
  });
});
