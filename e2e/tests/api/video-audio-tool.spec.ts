import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test.describe('Video & Audio marketplace tool', () => {
  test('keeps Local Whisper optional when the tool is bundled', async () => {
    execFileSync('pnpm', ['--filter', '@larkup/tool-video-audio', 'build'], {
      cwd: repoRoot,
      stdio: 'pipe',
    });

    const compiledProcessor = await readFile(
      path.join(repoRoot, 'packages/tools/video-audio/dist/audio-processor.js'),
      'utf8',
    );
    expect(compiledProcessor).toContain("const whisperModule = 'nodejs-whisper'");
    expect(compiledProcessor).not.toContain("import('nodejs-whisper')");

    const tool = await import(
      pathToFileURL(path.join(repoRoot, 'packages/tools/video-audio/dist/index.js')).href
    );
    expect(typeof tool.processVideo).toBe('function');
    await expect(
      tool.transcribeAudio('/not-used-for-provider-validation.wav', { provider: 'local' }),
    ).rejects.toThrow(/Local Whisper is not installed/i);
  });

  test('prepares a managed YouTube downloader instead of requiring a host yt-dlp command', async () => {
    execFileSync('pnpm', ['--filter', '@larkup/tool-video-audio', 'build'], {
      cwd: repoRoot,
      stdio: 'pipe',
    });

    const tool = await import(
      pathToFileURL(path.join(repoRoot, 'packages/tools/video-audio/dist/index.js')).href
    );
    const workspace = await mkdtemp(path.join(tmpdir(), 'larkup-ytdlp-managed-'));
    const originalFetch = globalThis.fetch;
    let downloadCount = 0;
    globalThis.fetch = async (input) => {
      downloadCount += 1;
      expect(String(input)).toMatch(/yt-dlp\/releases\/latest\/download\//);
      return new Response('managed yt-dlp binary', { status: 200 });
    };

    try {
      const firstPath = await tool.ensureManagedYtDlp(workspace);
      const secondPath = await tool.ensureManagedYtDlp(workspace);
      expect(firstPath).toBe(secondPath);
      expect(await readFile(firstPath, 'utf8')).toBe('managed yt-dlp binary');
      expect(downloadCount).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test('uses standalone platform releases and replaces the legacy Python launcher', async () => {
    execFileSync('pnpm', ['--filter', '@larkup/tool-video-audio', 'build'], {
      cwd: repoRoot,
      stdio: 'pipe',
    });
    const tool = await import(
      pathToFileURL(path.join(repoRoot, 'packages/tools/video-audio/dist/index.js')).href
    );
    expect(tool.getManagedYtDlpAssetName('darwin', 'arm64')).toBe('yt-dlp_macos');
    expect(tool.getManagedYtDlpAssetName('linux', 'x64')).toBe('yt-dlp_linux');
    expect(tool.getManagedYtDlpAssetName('linux', 'arm64')).toBe('yt-dlp_linux_aarch64');

    const workspace = await mkdtemp(path.join(tmpdir(), 'larkup-ytdlp-migrate-'));
    const binaryPath = tool.getManagedYtDlpPath(workspace);
    const originalFetch = globalThis.fetch;
    try {
      await mkdir(path.dirname(binaryPath), { recursive: true });
      await writeFile(binaryPath, '#!/usr/bin/env python3\nlegacy launcher');
      globalThis.fetch = async (input) => {
        expect(String(input)).toContain(tool.getManagedYtDlpAssetName());
        return new Response('standalone downloader', { status: 200 });
      };
      await tool.ensureManagedYtDlp(workspace);
      expect(await readFile(binaryPath, 'utf8')).toBe('standalone downloader');
    } finally {
      globalThis.fetch = originalFetch;
      await rm(workspace, { recursive: true, force: true });
    }
  });

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

      // The tool owns binary permissions: pnpm may skip dependency lifecycle
      // scripts, so ffprobe must still work without a host installation.
      const binaries = await import(
        pathToFileURL(path.join(repoRoot, 'packages/tools/video-audio/dist/ffmpeg-spawn.js')).href
      );
      await expect(binaries.ffprobe(videoPath)).resolves.toMatchObject({
        format: { duration: expect.any(String) },
      });

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

  test('aligns transcript and visual evidence into searchable timeline segments with running state', async () => {
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

    expect(typeof segments[0].cumulativeState).toBe('string');
    expect(typeof segments[1].cumulativeState).toBe('string');
    expect(segments[0].cumulativeState).toContain('2–3');
    expect(segments[1].text).toContain('Running state from earlier');
  });

  test('preserves bounded multilingual timeline context without domain-specific matching', async () => {
    execFileSync('pnpm', ['--filter', '@larkup/tool-video-audio', 'build'], {
      cwd: repoRoot,
      stdio: 'pipe',
    });
    const tool = await import(
      pathToFileURL(path.join(repoRoot, 'packages/tools/video-audio/dist/index.js')).href
    );

    const context = '製品の詳細: 色は青です。The device temperature is 42°C.';
    expect(tool.extractRunningState(context)).toBe(context);
    expect(tool.extractRunningState('  first\n second  ')).toBe('first second');
    expect(tool.extractRunningState('x'.repeat(600))).toHaveLength(500);
  });

  test('builds Deepgram requests with explicit languages or provider detection', async () => {
    execFileSync('pnpm', ['--filter', '@larkup/tool-video-audio', 'build'], {
      cwd: repoRoot,
      stdio: 'pipe',
    });
    const tool = await import(
      pathToFileURL(path.join(repoRoot, 'packages/tools/video-audio/dist/index.js')).href
    );

    expect(tool.inferLanguageHintFromText('任意のタイトル')).toBeUndefined();

    const automatic = new URL(
      tool.buildDeepgramTranscriptionUrl({
        language: 'auto',
        context: '研究発表と参加者の議論',
      }),
    );
    expect(automatic.searchParams.get('model')).toBe('nova-3-general');
    expect(automatic.searchParams.get('detect_language')).toBe('true');
    expect(automatic.searchParams.has('language')).toBe(false);
    expect(automatic.searchParams.getAll('keyterm')).toContain('研究発表と参加者の議論');

    const configured = new URL(
      tool.buildDeepgramTranscriptionUrl({
        language: 'de',
        context: 'Bundesliga Finale',
      }),
    );
    expect(configured.searchParams.get('model')).toBe('nova-3');
    expect(configured.searchParams.get('language')).toBe('de');
    expect(configured.searchParams.has('detect_language')).toBe(false);

    const workspace = await mkdtemp(path.join(tmpdir(), 'larkup-deepgram-e2e-'));
    const audioPath = path.join(workspace, 'audio.mp3');
    const originalFetch = globalThis.fetch;
    const progress: Array<{ current: number; total: number; message: string }> = [];
    let requestCount = 0;
    try {
      await writeFile(audioPath, Buffer.from('test audio'));
      globalThis.fetch = async (input) => {
        requestCount++;
        const requestUrl = new URL(String(input));
        expect(requestUrl.searchParams.get('model')).toBe('nova-3-general');
        expect(requestUrl.searchParams.get('detect_language')).toBe('true');
        return new Response(
          JSON.stringify({
            metadata: { duration: 2 },
            results: {
              channels: [
                {
                  detected_language: 'ja',
                  alternatives: [
                    {
                      transcript: '結論が発表されました',
                      words: [
                        { word: '結論が', punctuated_word: '結論が', start: 0, end: 0.8 },
                        {
                          word: '発表されました',
                          punctuated_word: '発表されました',
                          start: 0.8,
                          end: 2,
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      };

      const result = await tool.transcribeAudio(audioPath, {
        provider: 'deepgram',
        apiKey: 'test-key',
        language: 'auto',
        context: '研究発表と参加者の議論',
        onProgress: (current: number, total: number, message: string) => {
          progress.push({ current, total, message });
        },
      });

      expect(result).toMatchObject({
        fullText: '結論が発表されました',
        language: 'ja',
        origin: { kind: 'provider-stt', provider: 'deepgram', language: 'ja' },
      });
      expect(progress.map(({ current, total }) => [current, total])).toEqual([
        [0, 1],
        [1, 1],
      ]);
      await expect(
        tool.transcribeAudio(audioPath, {
          apiKey: 'a-gateway-key-must-never-be-guessed-as-openai',
        }),
      ).rejects.toThrow(/Audio Provider is required/i);
      expect(requestCount).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test('parses complete timestamped YouTube captions, including the final announced conclusion', async () => {
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
          { tStartMs: 0, dDurationMs: 4_000, segs: [{ utf8: 'The presentation begins.' }] },
          {
            tStartMs: 38_000,
            dDurationMs: 4_000,
            segs: [{ utf8: 'The proposal is under review.' }],
          },
          { tStartMs: 118_000, dDurationMs: 2_000, segs: [{ utf8: 'The proposal is approved.' }] },
        ],
      },
      120,
    );

    expect(transcript.durationSecs).toBe(120);
    expect(transcript.chunks.at(-1)).toMatchObject({
      text: 'The proposal is approved.',
      startSecs: 118,
      endSecs: 120,
    });
    expect(transcript.fullText).toContain('The proposal is under review.');
    expect(transcript.fullText).toContain('The proposal is approved.');
  });
});
test.describe('Adaptive video sampling plan', () => {
  test('bounds a 49-minute edited video without consuming the frame ceiling', async () => {
    execFileSync('pnpm', ['--filter', '@larkup/tool-video-audio', 'build'], {
      cwd: repoRoot,
      stdio: 'pipe',
    });
    const tool = await import(
      pathToFileURL(path.join(repoRoot, 'packages/tools/video-audio/dist/index.js')).href
    );

    const durationSecs = 49 * 60 + 24;
    const plan = tool.createVideoSamplingPlan(durationSecs, 30, 600);
    const lastPeriodicTimestamp = (plan.periodicFrameCount - 1) * plan.periodicIntervalSecs;

    expect(plan.periodicFrameCount).toBe(99);
    expect(plan.sceneFrameCount).toBe(99);
    expect(plan.endingFrameCount).toBe(18);
    expect(plan.estimatedFrameCount).toBeLessThan(250);
    expect(plan.estimatedFrameCount).toBeLessThan(plan.maxFrames);
    expect(lastPeriodicTimestamp).toBeGreaterThanOrEqual(durationSecs - plan.periodicIntervalSecs);
    expect(plan.minimumSceneGapSecs).toBeGreaterThanOrEqual(durationSecs / plan.sceneFrameCount);
  });

  test('uses sparse edge-to-edge coverage for an eight-hour recording', async () => {
    execFileSync('pnpm', ['--filter', '@larkup/tool-video-audio', 'build'], {
      cwd: repoRoot,
      stdio: 'pipe',
    });
    const tool = await import(
      pathToFileURL(path.join(repoRoot, 'packages/tools/video-audio/dist/index.js')).href
    );

    const durationSecs = 8 * 60 * 60;
    const plan = tool.createVideoSamplingPlan(durationSecs, 30, 600);
    const cappedPlan = tool.createVideoSamplingPlan(durationSecs, 30, 37);
    const lastPeriodicTimestamp = (plan.periodicFrameCount - 1) * plan.periodicIntervalSecs;

    expect(plan.periodicIntervalSecs).toBeGreaterThanOrEqual(10 * 60);
    expect(plan.estimatedFrameCount).toBeLessThanOrEqual(150);
    expect(lastPeriodicTimestamp).toBeGreaterThanOrEqual(durationSecs - plan.periodicIntervalSecs);
    expect(plan.minimumSceneGapSecs).toBeGreaterThanOrEqual(5 * 60);
    expect(cappedPlan.estimatedFrameCount).toBe(37);
    expect(cappedPlan.periodicFrameCount).toBeGreaterThan(0);
    expect(cappedPlan.sceneFrameCount).toBeGreaterThan(0);
    expect(cappedPlan.endingFrameCount).toBeGreaterThan(0);
    expect(cappedPlan.estimatedFrameCount).toBe(37);
  });

  test('adds a dense ending burst for fast-changing final result graphics', async () => {
    execFileSync('pnpm', ['--filter', '@larkup/tool-video-audio', 'build'], {
      cwd: repoRoot,
      stdio: 'pipe',
    });
    const tool = await import(
      pathToFileURL(path.join(repoRoot, 'packages/tools/video-audio/dist/index.js')).href
    );

    const plan = tool.createEndingSamplingPlan(49 * 60 + 24, 18);
    expect(plan).toMatchObject({ intervalSecs: 5, frameCount: 18 });
    expect(plan.timestamps[0]).toBe(47 * 60 + 54);
    expect(
      plan.timestamps.some((timestamp: number) => Math.abs(timestamp - (48 * 60 + 45)) <= 1),
    ).toBe(true);
    expect(plan.timestamps.at(-1)).toBeGreaterThanOrEqual(49 * 60 + 15);

    const cappedVideoPlan = tool.createVideoSamplingPlan(49 * 60 + 24, 30, 100);
    expect(cappedVideoPlan.endingFrameCount).toBe(18);
    expect(cappedVideoPlan.estimatedFrameCount).toBe(100);

    const singleEndingFrame = tool.createEndingSamplingPlan(49 * 60 + 24, 1);
    expect(singleEndingFrame.timestamps[0]).toBeGreaterThan(49 * 60);
  });
});

test.describe('Information-gain frame selection', () => {
  test('keeps protected coverage while dropping low-information candidates', async () => {
    execFileSync('pnpm', ['--filter', '@larkup/tool-video-audio', 'build'], {
      cwd: repoRoot,
      stdio: 'pipe',
    });
    const tool = await import(
      pathToFileURL(path.join(repoRoot, 'packages/tools/video-audio/dist/index.js')).href
    );
    const decisions = tool.selectFramesByInformationGain(
      [
        { path: 'first.jpg', timestampSecs: 0, protected: true, signals: {} },
        { path: 'noise.jpg', timestampSecs: 2, signals: {} },
        { path: 'scene.jpg', timestampSecs: 4, signals: { shotChange: 1, ocrChange: 1 } },
        { path: 'coverage.jpg', timestampSecs: 20, signals: {} },
      ],
      { maxFrames: 3, maximumCoverageGapSecs: 10 },
    );
    expect(decisions.map((item: { decision: string }) => item.decision)).toEqual([
      'protected',
      'dropped',
      'retained',
      'protected',
    ]);
  });

  test('never lets protected coverage candidates exceed the hard frame budget', async () => {
    execFileSync('pnpm', ['--filter', '@larkup/tool-video-audio', 'build'], {
      cwd: repoRoot,
      stdio: 'pipe',
    });
    const tool = await import(
      pathToFileURL(path.join(repoRoot, 'packages/tools/video-audio/dist/index.js')).href
    );
    const decisions = tool.selectFramesByInformationGain(
      [0, 11, 22, 33].map((timestampSecs) => ({
        path: `frame-${timestampSecs}.jpg`,
        timestampSecs,
        signals: {},
      })),
      { maxFrames: 3, maximumCoverageGapSecs: 10 },
    );
    expect(
      decisions.filter((item: { decision: string }) => item.decision !== 'dropped'),
    ).toHaveLength(3);
    expect(decisions.at(-1)).toMatchObject({ decision: 'dropped', reason: 'max-frame-budget' });
  });
});

test.describe('Evidence-grade probe', () => {
  test('probeMedia returns structured metadata with stream details', async () => {
    test.setTimeout(120_000);
    execFileSync('pnpm', ['--filter', '@larkup/tool-video-audio', 'build'], {
      cwd: repoRoot,
      stdio: 'pipe',
    });
    const tool = await import(
      pathToFileURL(path.join(repoRoot, 'packages/tools/video-audio/dist/index.js')).href
    );

    const workspace = await mkdtemp(path.join(tmpdir(), 'larkup-probe-e2e-'));
    try {
      const videoPath = path.join(workspace, 'test.mp4');
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
      // Create a 3-second test video with audio
      execFileSync(
        ffmpegPath,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-f',
          'lavfi',
          '-i',
          'testsrc=size=640x480:rate=25:duration=3',
          '-f',
          'lavfi',
          '-i',
          'sine=frequency=440:duration=3',
          '-c:v',
          'libx264',
          '-c:a',
          'aac',
          '-shortest',
          '-pix_fmt',
          'yuv420p',
          videoPath,
        ],
        { cwd: workspace },
      );

      const result = await tool.probeMedia(videoPath);

      // Check all required fields of MediaProbeResult
      expect(result.durationSecs).toBeGreaterThanOrEqual(2.5);
      expect(result.durationSecs).toBeLessThanOrEqual(4);
      expect(result.width).toBe(640);
      expect(result.height).toBe(480);
      expect(result.codec).toBe('h264');
      expect(typeof result.rotation).toBe('number');
      expect(result.videoStreamCount).toBe(1);
      expect(result.audioStreamCount).toBe(1);
      expect(result.subtitleStreamCount).toBe(0);
      expect(result.hasCorruptionSignals).toBe(false);
      expect(typeof result.formatName).toBe('string');
      expect(result.streams.length).toBeGreaterThanOrEqual(2);

      // Check stream detail shape
      const videoStream = result.streams.find((s: any) => s.codecType === 'video');
      const audioStream = result.streams.find((s: any) => s.codecType === 'audio');
      expect(videoStream).toMatchObject({
        codecType: 'video',
        codecName: 'h264',
        width: 640,
        height: 480,
      });
      expect(audioStream).toMatchObject({
        codecType: 'audio',
        codecName: 'aac',
      });
      expect(typeof videoStream.fps).toBe('number');
      expect(videoStream.fps).toBeGreaterThan(0);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});

test.describe('Single-frame extraction', () => {
  test('extractFrameAtTimestamp produces a JPEG at the requested timestamp', async () => {
    test.setTimeout(120_000);
    execFileSync('pnpm', ['--filter', '@larkup/tool-video-audio', 'build'], {
      cwd: repoRoot,
      stdio: 'pipe',
    });
    const tool = await import(
      pathToFileURL(path.join(repoRoot, 'packages/tools/video-audio/dist/index.js')).href
    );

    const workspace = await mkdtemp(path.join(tmpdir(), 'larkup-frame-e2e-'));
    try {
      const videoPath = path.join(workspace, 'test.mp4');
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
          'testsrc=size=320x180:rate=10:duration=5',
          '-pix_fmt',
          'yuv420p',
          videoPath,
        ],
        { cwd: workspace },
      );

      const outputDir = path.join(workspace, 'frame-output');
      const frame = await tool.extractFrameAtTimestamp(videoPath, 2.5, {
        outputDir,
        maxWidth: 320,
      });

      // Check FrameArtifact shape
      expect(frame.timestampSecs).toBe(2.5);
      expect(frame.path).toContain('frame_');
      expect(frame.path).toMatch(/\.jpg$/);
      await access(frame.path);

      // Verify the JPEG file is non-empty
      const stat = await readFile(frame.path);
      expect(stat.length).toBeGreaterThan(100);

      // Verify dimensions were probed
      expect(frame.width).toBeGreaterThan(0);
      expect(frame.height).toBeGreaterThan(0);

      // Extract at timestamp 0 (edge case)
      const firstFrame = await tool.extractFrameAtTimestamp(videoPath, 0, {
        outputDir: path.join(workspace, 'first-frame'),
      });
      expect(firstFrame.timestampSecs).toBe(0);
      await access(firstFrame.path);

      // Negative timestamp should be clamped to 0
      const negativeFrame = await tool.extractFrameAtTimestamp(videoPath, -5, {
        outputDir: path.join(workspace, 'negative-frame'),
      });
      expect(negativeFrame.timestampSecs).toBe(0);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});

test.describe('Bounded time-range inspection', () => {
  test('inspectTimeRange extracts frames within the requested range', async () => {
    test.setTimeout(120_000);
    execFileSync('pnpm', ['--filter', '@larkup/tool-video-audio', 'build'], {
      cwd: repoRoot,
      stdio: 'pipe',
    });
    const tool = await import(
      pathToFileURL(path.join(repoRoot, 'packages/tools/video-audio/dist/index.js')).href
    );

    const workspace = await mkdtemp(path.join(tmpdir(), 'larkup-inspect-e2e-'));
    try {
      const videoPath = path.join(workspace, 'test.mp4');
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
          'testsrc=size=320x180:rate=10:duration=10',
          '-pix_fmt',
          'yuv420p',
          videoPath,
        ],
        { cwd: workspace },
      );

      const result = await tool.inspectTimeRange({
        mediaPath: videoPath,
        startSecs: 2,
        endSecs: 6,
        purpose: 'verify-visual',
        maxFrames: 4,
        outputDir: path.join(workspace, 'inspect-output'),
      });

      // Check InspectionResult shape
      expect(result.frames.length).toBeGreaterThan(0);
      expect(result.frames.length).toBeLessThanOrEqual(4);
      expect(result.actualRange.startSecs).toBe(2);
      expect(result.actualRange.endSecs).toBeLessThanOrEqual(6);
      expect(result.probe.durationSecs).toBeGreaterThanOrEqual(9);

      // All frames should be within the range
      for (const frame of result.frames) {
        expect(frame.timestampSecs).toBeGreaterThanOrEqual(2);
        expect(frame.timestampSecs).toBeLessThanOrEqual(6);
        await access(frame.path);
      }

      // Frames should be sorted by timestamp
      for (let i = 1; i < result.frames.length; i++) {
        expect(result.frames[i].timestampSecs).toBeGreaterThanOrEqual(
          result.frames[i - 1].timestampSecs,
        );
      }

      // Dense fractional inspection must not overwrite frames that share the
      // same whole-second timestamp in the worker output directory.
      const denseResult = await tool.inspectTimeRange({
        mediaPath: videoPath,
        startSecs: 2,
        endSecs: 3,
        purpose: 'high-res-ocr',
        maxFrames: 24,
        outputDir: path.join(workspace, 'dense-inspect-output'),
      });
      expect(new Set(denseResult.frames.map((frame: { path: string }) => frame.path)).size).toBe(
        denseResult.frames.length,
      );
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});

test.describe('Video knowledge media primitives', () => {
  test('uses a low-resolution activity pass to find changing moments inside a bounded range', async () => {
    test.setTimeout(120_000);
    execFileSync('pnpm', ['--filter', '@larkup/tool-video-audio', 'build'], {
      cwd: repoRoot,
      stdio: 'pipe',
    });
    const tool = await import(
      pathToFileURL(path.join(repoRoot, 'packages/tools/video-audio/dist/index.js')).href
    );
    const workspace = await mkdtemp(path.join(tmpdir(), 'larkup-activity-e2e-'));
    try {
      const videoPath = path.join(workspace, 'activity.mp4');
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
          'testsrc2=size=320x180:rate=10:duration=6',
          '-pix_fmt',
          'yuv420p',
          videoPath,
        ],
        { cwd: workspace },
      );

      const frames = await tool.extractActivityFrames(videoPath, {
        outputDir: path.join(workspace, 'activity-frames'),
        durationSecs: 6,
        startSecs: 1,
        endSecs: 5,
        maxFrames: 3,
        minGapSecs: 1,
      });
      expect(frames.length).toBeGreaterThan(0);
      expect(frames.length).toBeLessThanOrEqual(3);
      for (const frame of frames) {
        expect(frame.timestampSecs).toBeGreaterThanOrEqual(1);
        expect(frame.timestampSecs).toBeLessThanOrEqual(5);
        await access(frame.path);
      }
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test('plans overlapping chunks and validates provider artifacts deterministically', async () => {
    execFileSync('pnpm', ['--filter', '@larkup/tool-video-audio', 'build'], {
      cwd: repoRoot,
      stdio: 'pipe',
    });
    const tool = await import(
      pathToFileURL(path.join(repoRoot, 'packages/tools/video-audio/dist/index.js')).href
    );
    expect(tool.createTimelineChunkPlan(610, 300, 3)).toEqual([
      { index: 0, startSecs: 0, endSecs: 300, overlapStartSecs: 0, overlapEndSecs: 303 },
      { index: 1, startSecs: 300, endSecs: 600, overlapStartSecs: 297, overlapEndSecs: 603 },
      { index: 2, startSecs: 600, endSecs: 610, overlapStartSecs: 597, overlapEndSecs: 610 },
    ]);
    expect(
      tool.validateOcrResult({
        blocks: [
          {
            text: ' כותרת ',
            left: 0,
            top: 0,
            width: 10,
            height: 5,
            confidence: 0.9,
            direction: 'rtl',
          },
          { text: '', left: 0, top: 0, width: 1, height: 1, confidence: 1 },
        ],
      }).blocks,
    ).toHaveLength(1);
    expect(
      tool.createArtifactCacheKey({
        contentHash: 'abc',
        operation: 'ocr',
        configuration: { language: 'he' },
      }),
    ).toBe(
      tool.createArtifactCacheKey({
        contentHash: 'abc',
        operation: 'ocr',
        configuration: { language: 'he' },
      }),
    );
  });
});
