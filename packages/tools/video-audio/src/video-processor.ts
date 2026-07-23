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
    options.onProgress?.((audioProgress + frameProgress) / 2);
  };

  // Cameras and screen recordings do not always have an audio stream. Visual
  // indexing must still succeed for those files.
  const extractAudioPromise = options.skipAudioExtraction
    ? Promise.resolve(undefined)
    : extractAudio(ffmpeg, videoPath, audioPath, options.threads, (progress) => {
        audioProgress = Math.max(audioProgress, progress);
        reportExtractionProgress();
      })
        .then(() => audioPath)
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
  const maxFrames = Math.max(1, options.maxFrames);
  const periodicBudget = Math.max(1, Math.ceil(maxFrames * 0.75));
  const sceneBudget = Math.max(0, maxFrames - periodicBudget);
  const effectiveInterval = Math.max(options.intervalSecs ?? 10, duration / periodicBudget);

  // Reserve most of the budget for evenly distributed frames. This guarantees
  // that a multi-hour static camera, slide deck, or dashboard is represented
  // from beginning to end instead of only near its first scene change.
  const periodicFrames = await extractFrames(videoPath, {
    outputDir: options.outputDir,
    intervalSecs: effectiveInterval,
    maxFrames: periodicBudget,
    durationSecs: duration,
    threads: options.threads,
    onProgress: (progress) => options.onProgress?.(progress * 0.7),
  });
  if (sceneBudget === 0) return periodicFrames;

  const threshold = options.sceneThreshold ?? 0.3;
  const minSceneGap = Math.max(1, Math.min(effectiveInterval / 2, duration / sceneBudget));
  const sceneDir = path.join(options.outputDir, 'scenes');
  await fs.mkdir(sceneDir, { recursive: true });
  const pattern = path.join(sceneDir, 'scene_%04d.jpg');
  let timestamps: number[] = [];
  await new Promise<void>((resolve, reject) => {
    ffmpeg
      .default(videoPath)
      .videoFilters(
        `select='gt(scene,${threshold})*if(isnan(prev_selected_t),1,gte(t-prev_selected_t,${minSceneGap}))',showinfo,scale=640:-1`,
      )
      .outputOptions([
        '-vsync vfr',
        `-frames:v ${sceneBudget}`,
        ...(options.threads ? [`-threads ${options.threads}`] : []),
      ])
      .output(pattern)
      .on('stderr', (line: string) => {
        const match = line.match(/pts_time:([0-9.]+)/);
        if (match) timestamps.push(Number(match[1]));
      })
      .on('progress', (progress: { percent?: number }) => {
        if (typeof progress.percent === 'number') {
          options.onProgress?.(0.7 + Math.min(1, progress.percent / 100) * 0.3);
        }
      })
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });
  const files = (await fs.readdir(sceneDir)).filter((name) => /^scene_\d+\.jpg$/.test(name)).sort();
  if (!files.length) return periodicFrames;
  timestamps = timestamps.slice(-files.length);
  const sceneFrames = files.map((name, index) => ({
    path: path.join(sceneDir, name),
    timestampSecs: timestamps[index] ?? (index * duration) / files.length,
  }));

  const merged = [...periodicFrames, ...sceneFrames].sort(
    (left, right) => left.timestampSecs - right.timestampSecs,
  );
  return merged.filter(
    (frame, index) =>
      index === 0 || Math.abs(frame.timestampSecs - merged[index - 1].timestampSecs) >= 1,
  );
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

  const frameCount = Math.max(
    1,
    Math.min(Math.ceil(duration / options.intervalSecs), options.maxFrames),
  );
  const pattern = path.join(options.outputDir, 'frame_%04d.jpg');
  await new Promise<void>((resolve, reject) => {
    ffmpeg
      .default(videoPath)
      .videoFilters(`fps=1/${options.intervalSecs},scale=640:-1`)
      .outputOptions([
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
    timestampSecs: index * options.intervalSecs,
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
