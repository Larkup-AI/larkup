import { describe, expect, it } from 'vitest';
import { inspectYouTubeMetadata, parseYtDlpProgress } from './source-utils';

describe('inspectYouTubeMetadata', () => {
  it('keeps the playlist total separate from the video selected by the watch URL', () => {
    const inspection = inspectYouTubeMetadata(
      'https://www.youtube.com/watch?v=selected-id&list=playlist-id&index=2',
      {
        title: 'A long playlist',
        entries: [
          { id: 'first-id', duration: 1_800 },
          { id: 'selected-id', duration: 3_600 },
          { id: 'third-id', duration: 2_400 },
        ],
      },
    );

    expect(inspection).toMatchObject({
      durationSecs: 7_800,
      singleItemDurationSecs: 3_600,
      singleItemUrl: 'https://www.youtube.com/watch?v=selected-id',
      entryCount: 3,
    });
  });

  it('selects the first entry when a playlist URL has no video id', () => {
    const inspection = inspectYouTubeMetadata('https://www.youtube.com/playlist?list=playlist-id', {
      entries: [
        { id: 'first-id', duration: 1_800 },
        { id: 'second-id', duration: 3_600 },
      ],
    });

    expect(inspection.singleItemDurationSecs).toBe(1_800);
    expect(inspection.singleItemUrl).toBe('https://www.youtube.com/watch?v=first-id');
  });
});

describe('parseYtDlpProgress', () => {
  it('keeps the downloader byte count, speed, ETA, and decimal percent', () => {
    const progress = parseYtDlpProgress(
      '[download]  12.5% of ~ 80.00MiB at 4.00MiB/s ETA 00:18',
      3,
    );

    expect(progress).toMatchObject({
      percent: 12.5,
      current: 10 * 1_024 ** 2,
      total: 80 * 1_024 ** 2,
      unit: 'bytes',
      elapsedSeconds: 3,
      estimatedRemainingSeconds: 18,
      message: 'Downloading video · 12.5% · 4.00MiB/s · 00:18 left',
    });
  });

  it('ignores downloader log lines that contain no measured progress', () => {
    expect(parseYtDlpProgress('[youtube] Extracting URL')).toBeNull();
  });
});
