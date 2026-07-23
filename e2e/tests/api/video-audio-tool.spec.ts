import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test.describe('Video & Audio marketplace tool', () => {
  test('extracts bounded scene frames and blocks private URL imports', async () => {
    test.setTimeout(120_000);
    execFileSync('pnpm', ['--filter', '@larkup/tool-video-audio', 'build'], {
      cwd: repoRoot,
      stdio: 'pipe',
    });

    const tool = await import(
      pathToFileURL(path.join(repoRoot, 'packages/tools/video-audio/dist/index.js')).href
    );
    await expect(tool.inspectMediaUrl('http://127.0.0.1/private.mp3')).rejects.toThrow(
      /private|local/i,
    );

    const workspace = await mkdtemp(path.join(tmpdir(), 'larkup-media-e2e-'));
    try {
      const videoPath = path.join(workspace, 'scenes.mp4');
      const ffmpegPath = execFileSync(
        'pnpm',
        [
          '--filter',
          '@larkup/tool-video-audio',
          'exec',
          'node',
          '-p',
          "require('@ffmpeg-installer/ffmpeg').path",
        ],
        { cwd: repoRoot, encoding: 'utf8' },
      ).trim();
      execFileSync(
        ffmpegPath,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-f',
          'lavfi',
          '-i',
          'testsrc=size=320x180:rate=10:duration=2',
          '-pix_fmt',
          'yuv420p',
          videoPath,
        ],
        { cwd: workspace },
      );

      const framesDir = path.join(workspace, 'frames');
      const frames = await tool.extractSceneFrames(videoPath, {
        outputDir: framesDir,
        durationSecs: 2,
        intervalSecs: 1,
        maxFrames: 2,
      });
      expect(frames.length).toBeGreaterThan(0);
      expect(frames.length).toBeLessThanOrEqual(2);
      await Promise.all(frames.map((frame: { path: string }) => access(frame.path)));
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test('aligns transcript and visual evidence into searchable timeline segments', async () => {
    execFileSync('pnpm', ['--filter', '@larkup/tool-video-audio', 'build'], {
      cwd: repoRoot,
      stdio: 'pipe',
    });
    const tool = await import(
      pathToFileURL(path.join(repoRoot, 'packages/tools/video-audio/dist/index.js')).href
    );

    const segments = tool.buildMultimodalSegments(
      [
        { text: 'The red team starts the final round.', startSecs: 40, endSecs: 55 },
        { text: 'The blue team wins.', startSecs: 65, endSecs: 75 },
      ],
      [
        {
          text: 'The scoreboard changes from 2–2 to 2–3 and the blue team celebrates.',
          startSecs: 55,
          endSecs: 90,
        },
      ],
      120,
      60,
    );

    expect(segments).toHaveLength(2);
    expect(segments[0].text).toContain('The red team starts');
    expect(segments[0].text).toContain('scoreboard changes');
    expect(segments[1].text).toContain('The blue team wins');
    expect(segments[1]).toMatchObject({ sequence: 1, startSecs: 60, endSecs: 120 });
  });

  test('parses complete timestamped YouTube captions, including the announced winner', async () => {
    execFileSync('pnpm', ['--filter', '@larkup/tool-video-audio', 'build'], {
      cwd: repoRoot,
      stdio: 'pipe',
    });
    const tool = await import(
      pathToFileURL(path.join(repoRoot, 'packages/tools/video-audio/dist/index.js')).href
    );

    const transcript = tool.parseYouTubeJson3Transcript(
      {
        events: [
          { tStartMs: 0, dDurationMs: 4_000, segs: [{ utf8: 'بدأت المباراة' }] },
          { tStartMs: 38_000, dDurationMs: 4_000, segs: [{ utf8: 'عبد العزيز متقدم' }] },
          { tStartMs: 118_000, dDurationMs: 2_000, segs: [{ utf8: 'الاسطى عبده هو الفائز' }] },
        ],
      },
      120,
    );

    expect(transcript.durationSecs).toBe(120);
    expect(transcript.chunks.at(-1)).toMatchObject({
      text: 'الاسطى عبده هو الفائز',
      startSecs: 118,
      endSecs: 120,
    });
    expect(transcript.fullText).toContain('عبد العزيز متقدم');
    expect(transcript.fullText).toContain('الاسطى عبده هو الفائز');
  });
});
