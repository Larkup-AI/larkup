import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ffprobeExecutable,
  hasInflatedPlaybackTimeline,
  inspectYouTubeMetadata,
  parseYoutubeJson3Transcript,
  parseYtDlpProgress,
  resolveYtDlpMediaPath,
  selectYoutubeCaptionLanguage,
  ytDlpImportPrintTemplate,
  youtubeDownloadFormat,
} from './source-utils';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

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

describe('youtubeDownloadFormat', () => {
  it('prefers a muxable MP4 video and M4A audio pair before combined fallbacks', () => {
    const [preferred, combinedFallback] = youtubeDownloadFormat().split('/');
    expect(preferred).toContain('bestvideo*');
    expect(preferred).toContain('[vcodec^=avc]');
    expect(preferred).toContain('+bestaudio[ext=m4a]');
    expect(combinedFallback).toContain('acodec!=none');
    expect(youtubeDownloadFormat().split('/').at(-1)).toContain('acodec!=none');
  });
});

describe('ytDlpImportPrintTemplate', () => {
  it('serializes one object so missing metadata never becomes a bare NA token', () => {
    const template = ytDlpImportPrintTemplate();

    expect(template).toBe('%(.{filepath,title,webpage_url,ext,language,requested_subtitles})j');
    expect(template).not.toContain('"language":%(language)j');
  });
});

describe('hasInflatedPlaybackTimeline', () => {
  it('detects a padded audio/container clock without flagging normal stream drift', () => {
    expect(
      hasInflatedPlaybackTimeline({
        durationSecs: 3_600,
        videoDurationSecs: 3_600,
        audioDurationSecs: 7_200,
        containerDurationSecs: 7_200,
        hasAudio: true,
        hasCorruptionSignals: false,
      }),
    ).toBe(true);
    expect(
      hasInflatedPlaybackTimeline({
        durationSecs: 3_600,
        videoDurationSecs: 3_600,
        audioDurationSecs: 3_602,
        containerDurationSecs: 3_602,
        hasAudio: true,
        hasCorruptionSignals: false,
      }),
    ).toBe(false);
  });
});

describe('parseYoutubeJson3Transcript', () => {
  it('turns native YouTube captions into timestamped evidence and ignores formatting events', () => {
    expect(
      parseYoutubeJson3Transcript({
        events: [
          { tStartMs: 14_000, dDurationMs: 2_500, segs: [{ utf8: 'The ' }, { utf8: 'answer' }] },
          { tStartMs: 16_500, dDurationMs: 500 },
        ],
      }),
    ).toEqual([{ text: 'The answer', startSecs: 14, endSecs: 16.5 }]);
  });
});

describe('selectYoutubeCaptionLanguage', () => {
  it('prefers a native manual caption over translated automatic tracks', () => {
    expect(
      selectYoutubeCaptionLanguage({
        language: 'de',
        subtitles: { de: [{}] },
        automatic_captions: { en: [{}], 'de-orig': [{}] },
      }),
    ).toBe('de');
  });

  it('falls back to the original-language automatic caption', () => {
    expect(
      selectYoutubeCaptionLanguage({
        language: 'ar',
        automatic_captions: { en: [{}], 'ar-orig': [{}] },
      }),
    ).toBe('ar-orig');
  });
});

describe('resolveYtDlpMediaPath', () => {
  it('uses the actual media output when yt-dlp reports a stale after-move filename', async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'larkup-source-utils-'));
    temporaryDirectories.push(outputDir);
    const reportedPath = path.join(outputDir, 'How Large Language Models Work [5sLYAQS9sWQ].mp4');
    const actualPath = path.join(
      outputDir,
      'How Large Language Models Work [5sLYAQS9sWQ].f251.webm',
    );
    await fs.writeFile(actualPath, 'video bytes');

    await expect(resolveYtDlpMediaPath(reportedPath, outputDir)).resolves.toBe(actualPath);
  });

  it('rejects a downloader path outside its isolated import directory', async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'larkup-source-utils-'));
    temporaryDirectories.push(outputDir);

    await expect(
      resolveYtDlpMediaPath(path.join(os.tmpdir(), 'unrelated.mp4'), outputDir),
    ).rejects.toThrow('outside its import directory');
  });

  it('prefers the final mux over a silent adaptive video intermediate', async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'larkup-source-utils-'));
    temporaryDirectories.push(outputDir);
    const reportedPath = path.join(outputDir, 'Interview [video123].missing.mp4');
    const silentIntermediate = path.join(outputDir, 'Interview [video123].f137.mp4');
    const finalMux = path.join(outputDir, 'Interview [video123].webm');
    await fs.writeFile(silentIntermediate, 'video only');
    await fs.writeFile(finalMux, 'video and audio');

    await expect(resolveYtDlpMediaPath(reportedPath, outputDir)).resolves.toBe(finalMux);
  });
});

describe('ffprobeExecutable', () => {
  const originalPath = process.env.LARKUP_FFPROBE_PATH;

  afterEach(() => {
    if (originalPath === undefined) delete process.env.LARKUP_FFPROBE_PATH;
    else process.env.LARKUP_FFPROBE_PATH = originalPath;
  });

  it('uses an explicit deployment override before the bundled binary', () => {
    process.env.LARKUP_FFPROBE_PATH = '/custom/bin/ffprobe';
    expect(ffprobeExecutable()).toBe('/custom/bin/ffprobe');
  });

  it('uses a packaged ffprobe binary when PATH is unavailable', () => {
    delete process.env.LARKUP_FFPROBE_PATH;
    expect(ffprobeExecutable()).toContain('ffprobe');
  });
});
