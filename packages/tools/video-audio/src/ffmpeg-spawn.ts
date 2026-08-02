import { spawn } from 'node:child_process';
import { chmodSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let _ffmpegPath: string | null = null;
let _ffprobePath: string | null = null;

/**
 * Some package managers intentionally skip dependency lifecycle scripts. The
 * bundled binaries are still valid in that case, but can lose their executable
 * bit on Unix. Repair it opportunistically; Windows ignores this permission.
 */
function prepareBundledBinary(binaryPath: string): string {
  try {
    chmodSync(binaryPath, 0o755);
  } catch {
    // Package files can be read-only in serverless deployments. Their package
    // archive permissions are normally already correct, so spawning remains
    // the final authority.
  }
  return binaryPath;
}

function resolveFfmpegPath(): string {
  if (_ffmpegPath) return _ffmpegPath;

  try {
    const installerPath = require.resolve('@ffmpeg-installer/ffmpeg');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const installer = require(installerPath) as { path?: string };
    if (installer?.path) {
      _ffmpegPath = prepareBundledBinary(installer.path);
      return _ffmpegPath;
    }
  } catch {
    // Use a system installation when the optional bundled binary is unavailable.
  }

  _ffmpegPath = 'ffmpeg';
  return _ffmpegPath;
}

function resolveFfprobePath(): string {
  if (_ffprobePath) return _ffprobePath;

  try {
    const installerPath = require.resolve('@ffprobe-installer/ffprobe');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const installer = require(installerPath) as { path?: string };
    if (installer?.path) {
      _ffprobePath = prepareBundledBinary(installer.path);
      return _ffprobePath;
    }
  } catch {
    // Use a system installation when the optional bundled binary is unavailable.
  }

  _ffprobePath = 'ffprobe';
  return _ffprobePath;
}

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

export interface FfmpegRunOptions {
  args: string[];
  /** Parse progress from stderr lines and call back with percent 0–1. */
  onProgress?: (percent: number) => void;
  /** Parse stderr lines (e.g. for showinfo timestamps). */
  onStderr?: (line: string) => void;
  /** Total duration in seconds — used to compute progress percentage. */
  durationSecs?: number;
}

export function runFfmpeg(options: FfmpegRunOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ['-y', ...options.args];
    const proc = spawn(resolveFfmpegPath(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderrBuf = '';

    proc.stderr.on('data', (data: Uint8Array) => {
      stderrBuf += data.toString();

      const lines = stderrBuf.split('\n');
      stderrBuf = lines.pop() ?? '';

      for (const line of lines) {
        options.onStderr?.(line);

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
