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
  audioPath: string;
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

  // 2. Extract audio
  const audioPath = path.join(options.outputDir, 'audio.wav');
  await extractAudio(ffmpeg, videoPath, audioPath);

  // 3. Extract keyframes
  const interval = options.frameIntervalSecs ?? 10;
  const maxFrames = options.maxFrames ?? 100;
  const frames = await extractFrames(videoPath, {
    outputDir: framesDir,
    intervalSecs: interval,
    maxFrames,
    durationSecs: meta.durationSecs,
  });

  return { audioPath, frames, meta };
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

  const frameCount = Math.min(Math.floor(duration / options.intervalSecs), options.maxFrames);

  const frames: { path: string; timestampSecs: number }[] = [];

  for (let i = 0; i < frameCount; i++) {
    const timestamp = i * options.intervalSecs;
    const framePath = path.join(options.outputDir, `frame_${String(i).padStart(4, '0')}.jpg`);

    await new Promise<void>((resolve, reject) => {
      ffmpeg
        .default(videoPath)
        .seekInput(timestamp)
        .frames(1)
        .size('640x?')
        .output(framePath)
        .on('end', () => resolve())
        .on('error', (err: Error) => reject(err))
        .run();
    });

    // Verify the frame was created
    try {
      await fs.access(framePath);
      frames.push({ path: framePath, timestampSecs: timestamp });
    } catch {
      // Frame extraction may fail at certain timestamps — skip
    }
  }

  return frames;
}

/* ------------------------------------------------------------------ */
/* Internal helpers                                                    */
/* ------------------------------------------------------------------ */

async function importFfmpeg() {
  const mod = await import('fluent-ffmpeg');
  // Set ffmpeg path from the installer package
  try {
    const installer = await import('@ffmpeg-installer/ffmpeg');
    mod.default.setFfmpegPath(installer.path);
  } catch {
    // If installer not available, assume ffmpeg is in PATH
  }
  return mod;
}

function extractAudio(ffmpeg: any, videoPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg
      .default(videoPath)
      .noVideo()
      .audioChannels(1)
      .audioFrequency(16000)
      .format('wav')
      .output(outputPath)
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
