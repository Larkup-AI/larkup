import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

    const context = 'تفاصيل المنتج: اللون أزرق. The device temperature is 42°C.';
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

    expect(tool.inferLanguageHintFromText('أي عنوان')).toBeUndefined();

    const automatic = new URL(
      tool.buildDeepgramTranscriptionUrl({
        language: 'auto',
        context: 'ديربي الكون مع عاشور و دكتور عبد العزيز',
      }),
    );
    expect(automatic.searchParams.get('model')).toBe('nova-3-general');
    expect(automatic.searchParams.get('detect_language')).toBe('true');
    expect(automatic.searchParams.has('language')).toBe(false);
    expect(automatic.searchParams.getAll('keyterm')).toContain('عاشور');
    expect(automatic.searchParams.getAll('keyterm')).toContain('العزيز');

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
                  detected_language: 'ar',
                  alternatives: [
                    {
                      transcript: 'فاز عاشور',
                      words: [
                        { word: 'فاز', punctuated_word: 'فاز', start: 0, end: 0.8 },
                        { word: 'عاشور', punctuated_word: 'عاشور', start: 0.8, end: 2 },
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
        context: 'ديربي الكون مع عاشور',
        onProgress: (current: number, total: number, message: string) => {
          progress.push({ current, total, message });
        },
      });

      expect(result).toMatchObject({
        fullText: 'فاز عاشور',
        language: 'ar',
        origin: { kind: 'provider-stt', provider: 'deepgram', language: 'ar' },
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
