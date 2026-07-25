import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Video processing pipeline.
 *
 * Uses ffmpeg (via fluent-ffmpeg) to:
 * 1. Extract audio track → send to audio-processor for transcription
 * 2. Extract keyframes at configurable intervals
 * 3. Generate thumbnails for each keyframe
 *
 * The caller (API route) handles Vision LLM captioning of frames.
 */

export interface VideoProcessResult {
  /** Path to extracted audio file (WAV, 16kHz mono) */
  audioPath?: string;
  /** Extracted keyframe image paths with timestamps */
  frames: { path: string; timestampSecs: number }[];
  /** Video metadata */
  meta: {
    durationSecs: number;
    width: number;
    height: number;
    codec: string;
  };
}

export interface VideoProcessOptions {
  /** Output directory for extracted files */
  outputDir: string;
  /** Extract one frame every N seconds (default: 10) */
  frameIntervalSecs?: number;
  /** Maximum number of frames to extract (default: 100) */
  maxFrames?: number;
  /** Scene detection sensitivity (default: 0.3; lower detects more changes) */
  sceneThreshold?: number;
  /** Maximum number of threads for FFmpeg to use */
  threads?: number;
  /** Whether to run parallel audio and frame extraction */
  parallelExtraction?: boolean;
  /** Skip audio extraction when an authoritative source transcript is available. */
  skipAudioExtraction?: boolean;
  /** Reports actual FFmpeg extraction progress as a value between 0 and 1. */
  onProgress?: (progress: number) => void;
}

export interface VideoSamplingPlan {
  /** Normalized video duration used to calculate the plan. */
  durationSecs: number;
  /** Hard ceiling for all extracted frames combined. */
  maxFrames: number;
  /** Cadence used for uniformly distributed coverage frames. */
  periodicIntervalSecs: number;
  /** Maximum number of uniformly distributed coverage frames. */
  periodicFrameCount: number;
  /** Maximum number of additional scene-change frames. */
  sceneFrameCount: number;
  /** Frames reserved for a denser look at the end of the recording. */
  endingFrameCount: number;
  /** Minimum time between selected scene changes. */
  minimumSceneGapSecs: number;
  /** Maximum periodic + scene + ending frames before de-duplication. */
  estimatedFrameCount: number;
}

export interface EndingSamplingPlan {
  startSecs: number;
  intervalSecs: number;
  frameCount: number;
  timestamps: number[];
}

export interface TimedText {
  text: string;
  startSecs: number;
  endSecs: number;
}

export interface MultimodalSegment extends TimedText {
  transcript: string;
  visualContext: string;
  sequence: number;
}

/**
 * Fuse speech and visual observations onto one timeline. Each searchable unit
 * contains everything that happened in the same time window instead of an
 * unrelated transcript or frame caption.
 */
export function buildMultimodalSegments(
  transcript: TimedText[],
  visuals: TimedText[],
  durationSecs: number,
  targetWindowSecs = 60,
): MultimodalSegment[] {
  const evidence = [...transcript, ...visuals];
  if (evidence.length === 0) return [];

  const knownEnd = Math.max(durationSecs, ...evidence.map((item) => item.endSecs));
  const segments: MultimodalSegment[] = [];

  for (let startSecs = 0; startSecs < knownEnd; startSecs += targetWindowSecs) {
    const endSecs = Math.min(startSecs + targetWindowSecs, knownEnd);
    const overlaps = (item: TimedText) => item.startSecs < endSecs && item.endSecs > startSecs;
    const spoken = transcript
      .filter(overlaps)
      .map((item) => item.text.trim())
      .filter(Boolean);
    const seen = visuals
      .filter(overlaps)
      .map((item) => item.text.trim())
      .filter(Boolean);
    if (spoken.length === 0 && seen.length === 0) continue;

    const transcriptText = [...new Set(spoken)].join(' ');
    const visualContext = [...new Set(seen)].join(' ');
    const parts = [
      `Timeline: ${formatTimestamp(startSecs)}–${formatTimestamp(endSecs)}.`,
      transcriptText ? `Speech: ${transcriptText}` : '',
      visualContext ? `Visual sequence, actions, and on-screen text: ${visualContext}` : '',
    ].filter(Boolean);

    segments.push({
      text: parts.join('\n'),
      transcript: transcriptText,
      visualContext,
      startSecs,
      endSecs,
      sequence: Math.floor(startSecs / targetWindowSecs),
    });
  }

  return segments;
}

function formatTimestamp(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`;
}

/**
 * Create a bounded frame-sampling plan without treating maxFrames as a quota.
 *
 * Edited videos receive frequent anchors and scene-change coverage. As duration
 * grows, the anchor cadence widens so multi-hour camera and screen recordings
 * remain searchable without generating hundreds of near-identical frames.
 */
export function createVideoSamplingPlan(
  durationSecs: number,
  configuredInterval = 30,
  maxFrames = 100,
): VideoSamplingPlan {
  const duration = Number.isFinite(durationSecs) ? Math.max(0, durationSecs) : 0;
  const hardLimit = Number.isFinite(maxFrames) ? Math.max(1, Math.floor(maxFrames)) : 100;
  const requestedInterval =
    Number.isFinite(configuredInterval) && configuredInterval > 0 ? configuredInterval : 30;

  let periodicFloorSecs: number;
  let sceneCadenceSecs: number;
  if (duration <= 15 * 60) {
    periodicFloorSecs = 15;
    sceneCadenceSecs = 15;
  } else if (duration <= 60 * 60) {
    periodicFloorSecs = 30;
    sceneCadenceSecs = 30;
  } else if (duration <= 4 * 60 * 60) {
    periodicFloorSecs = 2 * 60;
    sceneCadenceSecs = 2 * 60;
  } else if (duration <= 12 * 60 * 60) {
    periodicFloorSecs = 10 * 60;
    sceneCadenceSecs = 5 * 60;
  } else {
    periodicFloorSecs = 15 * 60;
    sceneCadenceSecs = 10 * 60;
  }

  const preferredInterval = Math.max(requestedInterval, periodicFloorSecs);
  const desiredPeriodicCount = Math.max(1, Math.ceil(duration / preferredInterval));
  const desiredSceneCount = duration > 0 ? Math.max(1, Math.ceil(duration / sceneCadenceSecs)) : 0;
  const desiredTotal = desiredPeriodicCount + desiredSceneCount;
  const desiredEndingCount =
    duration >= 60 ? Math.ceil(Math.min(90, duration) / (duration <= 2 * 60 * 60 ? 5 : 15)) : 0;
  const endingFrameCount =
    desiredEndingCount > 0
      ? Math.min(
          desiredEndingCount,
          hardLimit === 1 ? 1 : Math.max(1, Math.min(hardLimit - 1, Math.floor(hardLimit * 0.2))),
        )
      : 0;
  const coverageLimit = Math.max(0, hardLimit - endingFrameCount);

  let periodicFrameCount: number;
  let sceneFrameCount: number;
  if (coverageLimit === 0) {
    periodicFrameCount = 0;
    sceneFrameCount = 0;
  } else if (desiredTotal <= coverageLimit) {
    periodicFrameCount = desiredPeriodicCount;
    sceneFrameCount = desiredSceneCount;
  } else if (coverageLimit === 1 || desiredSceneCount === 0) {
    periodicFrameCount = 1;
    sceneFrameCount = 0;
  } else {
    // Preserve both uniform and change-based evidence when the natural plan
    // exceeds the hard limit, in proportion to the useful frames each needs.
    periodicFrameCount = Math.max(
      1,
      Math.min(
        coverageLimit - 1,
        Math.round((coverageLimit * desiredPeriodicCount) / desiredTotal),
      ),
    );
    sceneFrameCount = coverageLimit - periodicFrameCount;
  }

  const periodicIntervalSecs =
    periodicFrameCount > 0 && periodicFrameCount < desiredPeriodicCount && duration > 0
      ? Math.max(preferredInterval, duration / periodicFrameCount)
      : preferredInterval;
  const minimumSceneGapSecs =
    sceneFrameCount > 0 ? Math.max(1, periodicIntervalSecs / 2, duration / sceneFrameCount) : 0;

  return {
    durationSecs: duration,
    maxFrames: hardLimit,
    periodicIntervalSecs,
    periodicFrameCount,
    sceneFrameCount,
    endingFrameCount,
    minimumSceneGapSecs,
    estimatedFrameCount: periodicFrameCount + sceneFrameCount + endingFrameCount,
  };
}

/** Densely sample the ending where final results and decisions commonly appear. */
export function createEndingSamplingPlan(
  durationSecs: number,
  maxAdditionalFrames: number,
): EndingSamplingPlan {
  const duration = Number.isFinite(durationSecs) ? Math.max(0, durationSecs) : 0;
  const capacity = Number.isFinite(maxAdditionalFrames)
    ? Math.max(0, Math.floor(maxAdditionalFrames))
    : 0;
  if (duration < 60 || capacity === 0) {
    return {
      startSecs: Math.max(0, duration - 90),
      intervalSecs: 5,
      frameCount: 0,
      timestamps: [],
    };
  }
  const windowSecs = Math.min(90, duration);
  const preferredIntervalSecs = duration <= 2 * 60 * 60 ? 5 : 15;
  const desiredFrameCount = Math.ceil(windowSecs / preferredIntervalSecs);
  const frameCount = Math.min(capacity, desiredFrameCount);
  const windowStart = Math.max(0, duration - windowSecs);
  const endSecs = Math.max(windowStart, duration - Math.min(1, preferredIntervalSecs));
  const hasFullCadence = frameCount === desiredFrameCount;
  const startSecs =
    frameCount === 1 ? Math.max(windowStart, duration - preferredIntervalSecs) : windowStart;
  const intervalSecs = hasFullCadence
    ? preferredIntervalSecs
    : frameCount > 1
    ? Math.max(1, (endSecs - startSecs) / (frameCount - 1))
    : preferredIntervalSecs;
  return {
    startSecs,
    intervalSecs,
    frameCount,
    timestamps: Array.from({ length: frameCount }, (_, index) => startSecs + index * intervalSecs),
  };
}

/**
 * Process a video file: extract audio and keyframes.
 */
export async function processVideo(
  videoPath: string,
  options: VideoProcessOptions,
): Promise<VideoProcessResult> {
  const ffmpeg = await importFfmpeg();

  await fs.mkdir(options.outputDir, { recursive: true });
  const framesDir = path.join(options.outputDir, 'frames');
  await fs.mkdir(framesDir, { recursive: true });

  // 1. Probe video metadata
  const meta = await probeVideo(ffmpeg, videoPath);

  const audioPath = path.join(options.outputDir, 'audio.wav');
  const interval = options.frameIntervalSecs ?? 10;
  const maxFrames = options.maxFrames ?? 100;
  let audioProgress = options.skipAudioExtraction ? 1 : 0;
  let frameProgress = 0;
  const reportExtractionProgress = () => {
    options.onProgress?.(
      options.skipAudioExtraction ? frameProgress : (audioProgress + frameProgress) / 2,
    );
  };

  // Cameras and screen recordings do not always have an audio stream. Visual
  // indexing must still succeed for those files.
  const extractAudioPromise = options.skipAudioExtraction
    ? Promise.resolve(undefined)
    : extractAudio(ffmpeg, videoPath, audioPath, options.threads, (progress) => {
        audioProgress = Math.max(audioProgress, progress);
        reportExtractionProgress();
      })
        .then(() => {
          audioProgress = 1;
          reportExtractionProgress();
          return audioPath;
        })
        .catch(() => {
          // Videos without an audio stream remain valid visual-indexing input.
          audioProgress = 1;
          reportExtractionProgress();
          return undefined;
        });
  const extractFramesPromise = extractSceneFrames(videoPath, {
    outputDir: framesDir,
    intervalSecs: interval,
    maxFrames,
    durationSecs: meta.durationSecs,
    sceneThreshold: options.sceneThreshold,
    threads: options.threads,
    onProgress: (progress) => {
      frameProgress = Math.max(frameProgress, progress);
      reportExtractionProgress();
    },
  });

  let frames: { path: string; timestampSecs: number }[];
  let extractedAudioPath: string | undefined;
  if (options.parallelExtraction) {
    [extractedAudioPath, frames] = await Promise.all([extractAudioPromise, extractFramesPromise]);
  } else {
    extractedAudioPath = await extractAudioPromise;
    frames = await extractFramesPromise;
  }

  return { audioPath: extractedAudioPath, frames, meta };
}

/** Extract scene-change frames in one ffmpeg process, with adaptive interval fallback. */
export async function extractSceneFrames(
  videoPath: string,
  options: {
    outputDir: string;
    maxFrames: number;
    durationSecs?: number;
    intervalSecs?: number;
    sceneThreshold?: number;
    threads?: number;
    onProgress?: (progress: number) => void;
  },
): Promise<{ path: string; timestampSecs: number }[]> {
  const ffmpeg = await importFfmpeg();
  await fs.mkdir(options.outputDir, { recursive: true });
  const duration = options.durationSecs || (await probeVideo(ffmpeg, videoPath)).durationSecs;
  const plan = createVideoSamplingPlan(duration, options.intervalSecs, options.maxFrames);
  const totalPlannedWork = Math.max(1, plan.estimatedFrameCount);
  const periodicWeight = plan.periodicFrameCount / totalPlannedWork;
  const sceneWeight = plan.sceneFrameCount / totalPlannedWork;
  const endingWeight = plan.endingFrameCount / totalPlannedWork;
  let reportedProgress = 0;
  const reportProgress = (progress: number) => {
    reportedProgress = Math.max(reportedProgress, Math.max(0, Math.min(1, progress)));
    options.onProgress?.(reportedProgress);
  };
  const addEndingEvidence = async (
    frames: { path: string; timestampSecs: number }[],
  ): Promise<{ path: string; timestampSecs: number }[]> => {
    const remaining = Math.max(0, plan.maxFrames - frames.length);
    const endingPlan = createEndingSamplingPlan(
      duration,
      Math.min(remaining, plan.endingFrameCount),
    );
    if (endingPlan.frameCount === 0) {
      reportProgress(1);
      return frames.slice(0, plan.maxFrames);
    }

    // Outcomes, decisions, and final scoreboard animations often change several
    // times within a few seconds. A short ending burst complements the sparse
    // whole-video plan without turning the frame ceiling into a quota.
    const endingFrames = await extractFrames(videoPath, {
      outputDir: path.join(options.outputDir, 'ending'),
      intervalSecs: endingPlan.intervalSecs,
      maxFrames: endingPlan.frameCount,
      durationSecs: duration,
      startSecs: endingPlan.startSecs,
      threads: options.threads,
      onProgress: (progress) =>
        reportProgress(periodicWeight + sceneWeight + progress * endingWeight),
    });
    const merged = [...frames, ...endingFrames].sort(
      (left, right) => left.timestampSecs - right.timestampSecs,
    );
    const result = merged
      .filter(
        (frame, index) =>
          index === 0 || Math.abs(frame.timestampSecs - merged[index - 1].timestampSecs) >= 1,
      )
      .slice(0, plan.maxFrames);
    reportProgress(1);
    return result;
  };

  // Uniform frames guarantee beginning-to-end coverage, while the independent
  // scene pass captures meaningful changes between those anchors.
  const periodicFrames =
    plan.periodicFrameCount === 0
      ? []
      : duration >= 2 * 60 * 60
      ? await extractFramesAtTimestamps(
          ffmpeg,
          videoPath,
          Array.from({ length: plan.periodicFrameCount }, (_, index) =>
            Math.min(Math.max(0, duration - 1), index * plan.periodicIntervalSecs),
          ),
          {
            outputDir: options.outputDir,
            threads: options.threads,
            onProgress: (progress) => reportProgress(progress * periodicWeight),
          },
        )
      : await extractFrames(videoPath, {
          outputDir: options.outputDir,
          intervalSecs: plan.periodicIntervalSecs,
          maxFrames: plan.periodicFrameCount,
          durationSecs: duration,
          threads: options.threads,
          onProgress: (progress) => reportProgress(progress * periodicWeight),
        });
  if (plan.sceneFrameCount === 0) return addEndingEvidence(periodicFrames);

  const threshold = options.sceneThreshold ?? 0.3;
  const sceneDir = path.join(options.outputDir, 'scenes');
  await fs.mkdir(sceneDir, { recursive: true });
  const pattern = path.join(sceneDir, 'scene_%04d.jpg');
  let timestamps: number[] = [];
  await new Promise<void>((resolve) => {
    const command = ffmpeg.default(videoPath);
    const isLongRecording = duration >= 2 * 60 * 60;
    if (isLongRecording) {
      // Long surveillance/screen recordings are commonly mostly static. Decode
      // keyframes only and score changes at a smaller resolution so an 8-hour
      // input does not perform full-resolution scene math on every source frame.
      command.inputOptions(['-skip_frame nokey']);
    }
    command
      .videoFilters(
        isLongRecording
          ? `scale='min(640,iw)':-2,select='gt(scene,${threshold})*if(isnan(prev_selected_t),1,gte(t-prev_selected_t,${plan.minimumSceneGapSecs}))',showinfo`
          : `select='gt(scene,${threshold})*if(isnan(prev_selected_t),1,gte(t-prev_selected_t,${plan.minimumSceneGapSecs}))',showinfo,scale='min(1280,iw)':-2`,
      )
      .outputOptions([
        '-vsync vfr',
        `-frames:v ${plan.sceneFrameCount}`,
        ...(options.threads ? [`-threads ${options.threads}`] : []),
      ])
      .output(pattern)
      .on('stderr', (line: string) => {
        const match = line.match(/pts_time:([0-9.]+)/);
        if (match) timestamps.push(Number(match[1]));
      })
      .on('progress', (progress: { percent?: number }) => {
        if (typeof progress.percent === 'number') {
          reportProgress(periodicWeight + Math.min(1, progress.percent / 100) * sceneWeight);
        }
      })
      .on('end', () => resolve())
      .on('error', () => {
        // Scene detection is supplementary. Some ffmpeg versions report an
        // encoder error when the selector legitimately emits zero frames.
        // Uniform coverage frames must still make the video indexable.
        resolve();
      })
      .run();
  });
  reportProgress(periodicWeight + sceneWeight);
  const files = (await fs.readdir(sceneDir))
    .filter((name) => /^scene_\d+\.jpg$/.test(name))
    .sort()
    .slice(0, plan.sceneFrameCount);
  if (!files.length) return addEndingEvidence(periodicFrames);
  timestamps = timestamps.slice(-files.length);
  const sceneFrames = files.map((name, index) => ({
    path: path.join(sceneDir, name),
    timestampSecs: timestamps[index] ?? (index * duration) / files.length,
  }));

  const merged = [...periodicFrames, ...sceneFrames].sort(
    (left, right) => left.timestampSecs - right.timestampSecs,
  );
  const deduplicated = merged.filter(
    (frame, index) =>
      index === 0 || Math.abs(frame.timestampSecs - merged[index - 1].timestampSecs) >= 1,
  );
  return addEndingEvidence(deduplicated);
}

/**
 * Use input seeking for sparse anchors in multi-hour media. This avoids decoding
 * the entire recording once merely to retain a few dozen periodic frames.
 */
async function extractFramesAtTimestamps(
  ffmpeg: Awaited<ReturnType<typeof importFfmpeg>>,
  videoPath: string,
  timestamps: number[],
  options: {
    outputDir: string;
    threads?: number;
    onProgress?: (progress: number) => void;
  },
): Promise<{ path: string; timestampSecs: number }[]> {
  await fs.mkdir(options.outputDir, { recursive: true });
  const results = new Array<{ path: string; timestampSecs: number }>(timestamps.length);
  let cursor = 0;
  let completed = 0;

  await Promise.all(
    Array.from({ length: Math.min(2, timestamps.length) }, async () => {
      while (cursor < timestamps.length) {
        const index = cursor++;
        const timestampSecs = timestamps[index];
        const outputPath = path.join(
          options.outputDir,
          `frame_${String(index + 1).padStart(4, '0')}.jpg`,
        );
        await new Promise<void>((resolve, reject) => {
          ffmpeg
            .default(videoPath)
            .seekInput(timestampSecs)
            .videoFilters(`scale='min(1280,iw)':-2`)
            .outputOptions([
              '-frames:v 1',
              ...(options.threads ? [`-threads ${options.threads}`] : []),
            ])
            .output(outputPath)
            .on('end', () => resolve())
            .on('error', (error: Error) => reject(error))
            .run();
        });
        results[index] = { path: outputPath, timestampSecs };
        completed += 1;
        options.onProgress?.(completed / timestamps.length);
      }
    }),
  );

  return results;
}

/**
 * Extract keyframes from a video at regular intervals.
 */
export async function extractFrames(
  videoPath: string,
  options: {
    outputDir: string;
    intervalSecs: number;
    maxFrames: number;
    durationSecs?: number;
    /** Optional range start, used for denser ending/outcome evidence. */
    startSecs?: number;
    threads?: number;
    onProgress?: (progress: number) => void;
  },
): Promise<{ path: string; timestampSecs: number }[]> {
  const ffmpeg = await importFfmpeg();
  await fs.mkdir(options.outputDir, { recursive: true });

  // Get duration if not provided
  let duration = options.durationSecs;
  if (!duration) {
    const meta = await probeVideo(ffmpeg, videoPath);
    duration = meta.durationSecs;
  }

  const startSecs = Math.max(0, Math.min(options.startSecs ?? 0, duration));
  const rangeDuration = Math.max(0, duration - startSecs);
  const frameCount = Math.max(
    1,
    Math.min(Math.ceil(rangeDuration / options.intervalSecs), options.maxFrames),
  );
  const pattern = path.join(options.outputDir, 'frame_%04d.jpg');
  await new Promise<void>((resolve, reject) => {
    const command = ffmpeg.default(videoPath);
    if (startSecs > 0) command.seekInput(startSecs);
    command
      .videoFilters(
        `select='if(isnan(prev_selected_t),1,gte(t-prev_selected_t,${options.intervalSecs}))',scale='min(1280,iw)':-2`,
      )
      .outputOptions([
        '-vsync vfr',
        `-frames:v ${frameCount}`,
        ...(options.threads ? [`-threads ${options.threads}`] : []),
      ])
      .output(pattern)
      .on('progress', (progress: { percent?: number }) => {
        if (typeof progress.percent === 'number') {
          options.onProgress?.(Math.min(1, progress.percent / 100));
        }
      })
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(err))
      .run();
  });
  const files = (await fs.readdir(options.outputDir))
    .filter((name) => /^frame_\d+\.jpg$/.test(name))
    .sort()
    .slice(0, frameCount);
  return files.map((name, index) => ({
    path: path.join(options.outputDir, name),
    timestampSecs: startSecs + index * options.intervalSecs,
  }));
}

/* ------------------------------------------------------------------ */
/* Internal helpers                                                    */
/* ------------------------------------------------------------------ */

async function importFfmpeg() {
  const mod = await import('fluent-ffmpeg');
  return mod;
}

function extractAudio(
  ffmpeg: any,
  videoPath: string,
  outputPath: string,
  threads?: number,
  onProgress?: (progress: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let cmd = ffmpeg
      .default(videoPath)
      .noVideo()
      .audioChannels(1)
      .audioFrequency(16000)
      .format('wav');

    if (threads) {
      cmd = cmd.outputOptions([`-threads ${threads}`]);
    }

    cmd
      .output(outputPath)
      .on('progress', (progress: { percent?: number }) => {
        if (typeof progress.percent === 'number') {
          onProgress?.(Math.min(1, progress.percent / 100));
        }
      })
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(err))
      .run();
  });
}

interface VideoMeta {
  durationSecs: number;
  width: number;
  height: number;
  codec: string;
}

function probeVideo(ffmpeg: any, videoPath: string): Promise<VideoMeta> {
  return new Promise((resolve, reject) => {
    ffmpeg.default.ffprobe(videoPath, (err: Error | null, data: any) => {
      if (err) return reject(err);
      const videoStream = data.streams?.find((s: any) => s.codec_type === 'video');
      resolve({
        durationSecs: parseFloat(data.format?.duration ?? '0'),
        width: videoStream?.width ?? 0,
        height: videoStream?.height ?? 0,
        codec: videoStream?.codec_name ?? 'unknown',
      });
    });
  });
}
