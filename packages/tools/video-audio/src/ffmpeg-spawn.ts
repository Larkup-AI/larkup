/**
 * Lightweight ffmpeg/ffprobe helpers using child_process.spawn.
 *
 * Replaces the deprecated `fluent-ffmpeg` library with direct process
 * spawning for maximum compatibility and zero third-party runtime deps.
 */

import { spawn } from 'node:child_process';

/* ------------------------------------------------------------------ */
/* Binary resolution                                                    */
/* ------------------------------------------------------------------ */

let _ffmpegPath: string | null = null;
let _ffprobePath: string | null = null;

/**
 * Resolve the ffmpeg binary path. Prefers the system binary on PATH;
 * falls back to `@ffmpeg-installer/ffmpeg` if installed.
 */
function resolveFfmpegPath(): string {
  if (_ffmpegPath) return _ffmpegPath;

  // Try @ffmpeg-installer first (bundled binary)
  try {
    const installerPath = require.resolve('@ffmpeg-installer/ffmpeg');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const installer = require(installerPath) as { path?: string };
    if (installer?.path) {
      _ffmpegPath = installer.path;
      return _ffmpegPath;
    }
  } catch {
    // Not installed — fall through to system binary
  }

  _ffmpegPath = 'ffmpeg';
  return _ffmpegPath;
}

function resolveFfprobePath(): string {
  if (_ffprobePath) return _ffprobePath;

  // Try @ffprobe-installer first
  try {
    const installerPath = require.resolve('@ffprobe-installer/ffprobe');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const installer = require(installerPath) as { path?: string };
    if (installer?.path) {
      _ffprobePath = installer.path;
      return _ffprobePath;
    }
  } catch {
    // Not installed — fall through
  }

  _ffprobePath = 'ffprobe';
  return _ffprobePath;
}

/* ------------------------------------------------------------------ */
/* ffprobe                                                              */
/* ------------------------------------------------------------------ */

export interface ProbeResult {
  format: {
    duration?: string;
    [key: string]: unknown;
  };
  streams: Array<{
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    [key: string]: unknown;
  }>;
}

/**
 * Probe a media file for metadata using ffprobe.
 */
export function ffprobe(filePath: string): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const args = [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      filePath,
    ];

    const proc = spawn(resolveFfprobePath(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Uint8Array[] = [];
    let stderr = '';

    proc.stdout.on('data', (data: Uint8Array) => chunks.push(data));
    proc.stderr.on('data', (data: Uint8Array) => {
      stderr += data.toString();
    });

    proc.on('close', (code: number | null) => {
      if (code !== 0) {
        return reject(new Error(`ffprobe exited with code ${code}: ${stderr}`));
      }
      try {
        const json = JSON.parse(Buffer.concat(chunks).toString());
        resolve(json as ProbeResult);
      } catch (err) {
        reject(new Error(`Failed to parse ffprobe output: ${err}`));
      }
    });

    proc.on('error', reject);
  });
}

/* ------------------------------------------------------------------ */
/* ffmpeg runner                                                        */
/* ------------------------------------------------------------------ */

export interface FfmpegRunOptions {
  args: string[];
  /** Parse progress from stderr lines and call back with percent 0–1. */
  onProgress?: (percent: number) => void;
  /** Parse stderr lines (e.g. for showinfo timestamps). */
  onStderr?: (line: string) => void;
  /** Total duration in seconds — used to compute progress percentage. */
  durationSecs?: number;
}

/**
 * Run an ffmpeg command and return a promise that resolves on success.
 */
export function runFfmpeg(options: FfmpegRunOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ['-y', ...options.args];
    const proc = spawn(resolveFfmpegPath(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderrBuf = '';

    proc.stderr.on('data', (data: Uint8Array) => {
      stderrBuf += data.toString();

      // Process line by line
      const lines = stderrBuf.split('\n');
      stderrBuf = lines.pop() ?? '';

      for (const line of lines) {
        options.onStderr?.(line);

        // Parse progress: "time=HH:MM:SS.ms" or "time=SS.ms"
        if (options.onProgress && options.durationSecs && options.durationSecs > 0) {
          const timeMatch = line.match(/time=(\d+):(\d+):(\d+)\.(\d+)/);
          if (timeMatch) {
            const secs =
              parseInt(timeMatch[1], 10) * 3600 +
              parseInt(timeMatch[2], 10) * 60 +
              parseInt(timeMatch[3], 10) +
              parseInt(timeMatch[4], 10) / 100;
            options.onProgress(Math.min(1, secs / options.durationSecs));
          }
        }
      }
    });

    proc.on('close', (code: number | null) => {
      if (code !== 0) {
        return reject(new Error(`ffmpeg exited with code ${code}`));
      }
      resolve();
    });

    proc.on('error', reject);
  });
}
