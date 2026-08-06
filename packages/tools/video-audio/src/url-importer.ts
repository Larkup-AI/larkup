import type { TranscriptionResult, TranscriptChunk } from './audio-processor.js';
import { createWriteStream, promises as fs } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { isIP } from 'node:net';
import path from 'node:path';

export type MediaType = 'audio' | 'video' | 'unknown';
export interface ImportedMedia {
  path: string;
  originalUrl: string;
  title: string;
  mimeType?: string;
  mediaType: MediaType;
  /** Timestamped first-party captions when the source provides them. */
  sourceTranscript?: TranscriptionResult;
}
export interface UrlImportOptions {
  outputDir: string;
  /** Direct-download byte limit (default: 500 MiB). */
  maxBytes?: number;
  /** Maximum YouTube playlist entries (default: 10). */
  playlistMax?: number;
  /** Surface download activity to the lightweight media job status. */
  onProgress?: (progress: { percent?: number; message: string }) => void;
}
export interface UrlInspection {
  originalUrl: string;
  title?: string;
  mimeType?: string;
  mediaType: MediaType;
  contentLength?: number;
  durationSecs?: number;
  entryCount?: number;
  isYouTube: boolean;
}

const YT_DLP_DOWNLOAD_TIMEOUT_MS = 120_000;
const managedYtDlpDownloads = new Map<string, Promise<string>>();
const youtubeTranscriptCache = new Map<string, Promise<TranscriptionResult | undefined>>();

/** Choose an official standalone asset; the generic Unix launcher needs host Python. */
export function getManagedYtDlpAssetName(platform = process.platform, arch = process.arch): string {
  if (platform === 'win32') return arch === 'arm64' ? 'yt-dlp_arm64.exe' : 'yt-dlp.exe';
  if (platform === 'darwin') return 'yt-dlp_macos';
  if (platform === 'linux') return arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';
  // The platform-independent launcher remains the only official option for
  // less common systems, where the host must provide a supported Python.
  return 'yt-dlp';
}

export function getManagedYtDlpDownloadUrl(
  platform = process.platform,
  arch = process.arch,
): string {
  return `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${getManagedYtDlpAssetName(
    platform,
    arch,
  )}`;
}

async function isLegacyPythonYtDlp(binaryPath: string): Promise<boolean> {
  try {
    const bytes = await fs.readFile(binaryPath);
    return /^#!.*\bpython(?:3)?\b/m.test(bytes.subarray(0, 512).toString('utf8'));
  } catch {
    return false;
  }
}

/**
 * The Video & Audio tool owns its YouTube downloader. The official standalone
 * yt-dlp release is downloaded once into Larkup's writable tool directory and
 * reused thereafter, so users never need to install a host command themselves.
 */
export function getManagedYtDlpPath(rootDir = process.cwd()): string {
  const executable = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  return path.join(rootDir, '.larkup', 'tools', 'bin', executable);
}

export async function ensureManagedYtDlp(rootDir = process.cwd()): Promise<string> {
  const configuredPath = process.env.LARKUP_YTDLP_PATH?.trim();
  if (configuredPath) return configuredPath;

  const binaryPath = getManagedYtDlpPath(rootDir);
  try {
    await fs.access(binaryPath);
    // Previous releases downloaded the platform-independent Unix launcher on
    // macOS/Linux. It breaks on the older Python shipped by many systems.
    // Replace it automatically with the official standalone release.
    if (!(await isLegacyPythonYtDlp(binaryPath))) return binaryPath;
    await fs.rm(binaryPath, { force: true });
  } catch {
    // Download below. The map prevents simultaneous media jobs from racing to
    // write the same executable on first use.
  }

  const pending = managedYtDlpDownloads.get(binaryPath);
  if (pending) return pending;

  const download = (async () => {
    const downloadUrl = getManagedYtDlpDownloadUrl();
    const temporaryPath = `${binaryPath}.${randomUUID()}.download`;

    try {
      await fs.mkdir(path.dirname(binaryPath), { recursive: true });
      const response = await fetch(downloadUrl, {
        redirect: 'follow',
        signal: AbortSignal.timeout(YT_DLP_DOWNLOAD_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`download returned HTTP ${response.status}`);
      }
      await fs.writeFile(temporaryPath, Buffer.from(await response.arrayBuffer()), {
        mode: 0o755,
      });
      if (process.platform !== 'win32') await fs.chmod(temporaryPath, 0o755);
      await fs.rename(temporaryPath, binaryPath);
      return binaryPath;
    } catch (error) {
      await fs.rm(temporaryPath, { force: true }).catch(() => {});
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Could not prepare the built-in YouTube downloader. Check your internet connection and try again. (${detail})`,
      );
    } finally {
      managedYtDlpDownloads.delete(binaryPath);
    }
  })();

  managedYtDlpDownloads.set(binaryPath, download);
  return download;
}

export async function inspectMediaUrl(url: string): Promise<UrlInspection> {
  const parsed = validHttpUrl(url);
  if (isYouTube(parsed)) {
    try {
      const output = await runYtDlp([
        '--dump-single-json',
        '--simulate',
        '--flat-playlist',
        '--playlist-end',
        '10',
        url,
      ]);
      const data = JSON.parse(output) as {
        title?: string;
        duration?: number;
        entries?: { duration?: number }[];
      };
      const entries = data.entries?.slice(0, 10) ?? [];
      return {
        originalUrl: url,
        title: data.title,
        durationSecs:
          data.duration ?? entries.reduce((sum, entry) => sum + (entry.duration ?? 0), 0),
        entryCount: Math.max(entries.length, 1),
        mediaType: 'video',
        isYouTube: true,
      };
    } catch (error) {
      throw friendlyVideoDownloadError(error);
    }
  }
  let response = await fetchPublic(url, { method: 'HEAD' });
  if (response.status === 405 || response.status === 501) {
    response = await fetchPublic(url, { headers: { Range: 'bytes=0-0' } });
  }
  if (!response.ok) throw new Error(`Unable to inspect media URL (${response.status})`);
  const headerMime = response.headers.get('content-type')?.split(';')[0];
  const mimeType =
    mediaTypeFromMime(headerMime) === 'unknown'
      ? mimeFromExtension(path.extname(parsed.pathname).slice(1))
      : headerMime;
  const rangeTotal = response.headers.get('content-range')?.match(/\/(\d+)$/)?.[1];
  const inspection = {
    originalUrl: url,
    mimeType,
    mediaType: mediaTypeFromMime(mimeType),
    contentLength: Number(rangeTotal ?? response.headers.get('content-length')) || undefined,
    durationSecs: Number(response.headers.get('content-duration')) || undefined,
    entryCount: 1,
    isYouTube: false,
  };
  await response.body?.cancel();
  return inspection;
}

export async function importMediaUrl(
  url: string,
  options: UrlImportOptions,
): Promise<ImportedMedia[]> {
  const parsed = validHttpUrl(url);
  await fs.mkdir(options.outputDir, { recursive: true });
  if (isYouTube(parsed)) {
    const template = path.join(options.outputDir, '%(title).120B [%(id)s].%(ext)s');
    const print =
      '{"path":%(filepath)j,"title":%(title)j,"originalUrl":%(webpage_url)j,"ext":%(ext)j}';
    const commonArgs = [
      '--no-playlist',
      '--playlist-end',
      String(options.playlistMax ?? 10),
      '--socket-timeout',
      '20',
      '--retries',
      '2',
      '--fragment-retries',
      '2',
      '--format',
      'best[height<=360]/bestvideo[height<=360]+bestaudio/best',
      '--merge-output-format',
      'mp4',
      '-o',
      template,
      '--print',
      `after_move:${print}`,
    ];
    let output: string;
    try {
      output = await runYtDlp(
        [...commonArgs, '--concurrent-fragments', '4', url],
        options.onProgress,
      );
    } catch (error) {
      if (!isVideoHostForbidden(error)) throw friendlyVideoDownloadError(error);
      // Retry once with a freshly resolved URL and lower fragment concurrency.
      options.onProgress?.({ message: 'Source rejected the download; refreshing the video link…' });
      try {
        output = await runYtDlp(
          [
            ...commonArgs,
            '--force-ipv4',
            '--extractor-retries',
            '3',
            '--concurrent-fragments',
            '1',
            url,
          ],
          options.onProgress,
        );
      } catch (retryError) {
        throw friendlyVideoDownloadError(retryError);
      }
    }
    const imported = output
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const item = JSON.parse(line) as {
          path: string;
          title: string;
          originalUrl: string;
          ext: string;
        };
        return {
          path: item.path,
          title: item.title,
          originalUrl: item.originalUrl || url,
          mimeType: mimeFromExtension(item.ext),
          mediaType: mediaTypeFromMime(mimeFromExtension(item.ext)),
        };
      });
    return Promise.all(
      imported.map(async (item) => ({
        ...item,
        sourceTranscript: await getCachedYouTubeTranscript(item.originalUrl),
      })),
    );
  }
  const response = await fetchPublic(url);
  if (!response.ok || !response.body) throw new Error(`Media download failed (${response.status})`);
  const maxBytes = options.maxBytes ?? 500 * 1024 * 1024;
  const declared = Number(response.headers.get('content-length'));
  if (declared > maxBytes) throw new Error(`Media exceeds download limit of ${maxBytes} bytes`);
  const headerMime = response.headers.get('content-type')?.split(';')[0];
  const rawName = path.basename(new URL(response.url).pathname) || 'download';
  const name = rawName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180) || 'download';
  const mimeType =
    mediaTypeFromMime(headerMime) === 'unknown'
      ? mimeFromExtension(path.extname(name).slice(1))
      : headerMime;
  const outputPath = path.join(options.outputDir, `${randomUUID()}-${name}`);
  let bytes = 0;
  const body = Readable.fromWeb(response.body as never);
  body.on('data', (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > maxBytes)
      body.destroy(new Error(`Media exceeds download limit of ${maxBytes} bytes`));
  });
  try {
    await pipeline(body, createWriteStream(outputPath, { flags: 'wx' }));
  } catch (error) {
    await fs.rm(outputPath, { force: true });
    throw error;
  }
  return [
    {
      path: outputPath,
      originalUrl: url,
      title: name,
      mimeType,
      mediaType: mediaTypeFromMime(mimeType),
    },
  ];
}

/** Fetch captions independently from the video bytes and memoize a source URL within this worker. */
async function getCachedYouTubeTranscript(url: string): Promise<TranscriptionResult | undefined> {
  const existing = youtubeTranscriptCache.get(url);
  if (existing) return existing;
  const pending = fetchYouTubeTranscript(url).catch(() => undefined);
  youtubeTranscriptCache.set(url, pending);
  return pending;
}

function isVideoHostForbidden(error: unknown): boolean {
  return error instanceof Error && /\b(?:403|forbidden)\b/i.test(error.message);
}

function friendlyVideoDownloadError(error: unknown): Error {
  if (isVideoHostForbidden(error)) {
    return new Error(
      'The video host refused this download (HTTP 403). This is a temporary source restriction, not a problem with your index. Try again later, or upload the original video file directly.',
    );
  }
  if (error instanceof Error) {
    let msg = error.message;
    if (msg.includes('yt-dlp failed')) {
      const match = msg.match(/ERROR:\s*(.+)/);
      if (match) {
        msg = `Video download failed: ${match[1].trim()}`;
      } else {
        const detail = msg
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .at(-1);
        msg = detail
          ? `Video download failed: ${detail.slice(0, 500)}`
          : 'Video download failed. The source did not provide a usable error message.';
      }
      return new Error(msg);
    }
    return error;
  }
  return new Error('Video download failed. Please try again.');
}

async function fetchYouTubeTranscript(url: string): Promise<TranscriptionResult | undefined> {
  const output = await runYtDlp(['--dump-single-json', '--skip-download', '--no-playlist', url]);
  const data = JSON.parse(output) as {
    duration?: number;
    language?: string;
    subtitles?: Record<string, SubtitleFormat[]>;
    automatic_captions?: Record<string, SubtitleFormat[]>;
  };
  const manualTrack = selectSubtitleTrack(data.subtitles, data.language);
  const selected = manualTrack ?? selectSubtitleTrack(data.automatic_captions, data.language);
  if (!selected) return undefined;

  const response = await fetch(selected.url);
  if (!response.ok) throw new Error(`YouTube captions download failed (${response.status})`);
  const transcript = parseYouTubeJson3Transcript(await response.json(), data.duration ?? 0);
  return transcript.chunks.length > 0
    ? {
        ...transcript,
        language: selected.language,
        origin: {
          kind: manualTrack ? 'youtube-manual' : 'youtube-auto',
          language: selected.language,
        },
      }
    : undefined;
}

interface SubtitleFormat {
  ext?: string;
  url?: string;
}

function selectSubtitleTrack(
  tracks: Record<string, SubtitleFormat[]> | undefined,
  language: string | undefined,
): { url: string; language: string } | undefined {
  if (!tracks) return undefined;
  const languages = Object.keys(tracks).filter((key) => key !== 'live_chat');
  const baseLanguage = language?.split('-')[0];
  const preferredLanguages = [
    language,
    language ? `${language}-orig` : undefined,
    baseLanguage,
    baseLanguage ? `${baseLanguage}-orig` : undefined,
    ...languages.filter((key) => key.endsWith('-orig')),
    ...languages,
  ].filter((key): key is string => Boolean(key));

  for (const key of [...new Set(preferredLanguages)]) {
    const format = tracks[key]?.find((candidate) => candidate.ext === 'json3' && candidate.url);
    if (format?.url) return { url: format.url, language: key.replace(/-orig$/, '') };
  }
  return undefined;
}

export function parseYouTubeJson3Transcript(
  data: {
    events?: { tStartMs?: number; dDurationMs?: number; segs?: { utf8?: string }[] }[];
  },
  durationSecs = 0,
  chunkDurationSecs = 30,
): TranscriptionResult {
  const cues = (data.events ?? [])
    .map((event) => ({
      text: (event.segs ?? [])
        .map((segment) => segment.utf8 ?? '')
        .join('')
        .replace(/\s+/g, ' ')
        .trim(),
      startSecs: Math.max(0, Number(event.tStartMs ?? 0) / 1_000),
      endSecs: Math.max(
        0,
        Number(event.tStartMs ?? 0) / 1_000 + Number(event.dDurationMs ?? 0) / 1_000,
      ),
    }))
    .filter((cue) => cue.text);
  const chunks: TranscriptChunk[] = [];

  for (const cue of cues) {
    const current = chunks.at(-1);
    if (!current || cue.startSecs - current.startSecs >= chunkDurationSecs) {
      chunks.push({ ...cue });
    } else {
      current.text = `${current.text} ${cue.text}`;
      current.endSecs = Math.max(current.endSecs, cue.endSecs);
    }
  }

  return {
    fullText: chunks.map((chunk) => chunk.text).join(' '),
    chunks,
    durationSecs: Math.max(durationSecs, chunks.at(-1)?.endSecs ?? 0),
  };
}

function validHttpUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new Error('Only http(s) media URLs are supported');
  return url;
}

async function fetchPublic(url: string, init: RequestInit = {}): Promise<Response> {
  let current = validHttpUrl(url);
  for (let redirects = 0; redirects <= 5; redirects++) {
    await assertPublicHost(current.hostname);
    const response = await fetch(current, { ...init, redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    if (!location) throw new Error('Media URL redirected without a location');
    current = validHttpUrl(new URL(location, current).toString());
  }
  throw new Error('Media URL redirected too many times');
}

async function assertPublicHost(hostname: string): Promise<void> {
  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error('Private or local media URLs are not supported');
  }
}

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === '::1' || normalized === '::' || normalized.startsWith('fe80:')) return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  const ipv4 = normalized.startsWith('::ffff:') ? normalized.slice(7) : normalized;
  const parts = ipv4.split('.').map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return false;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}
function isYouTube(url: URL): boolean {
  return /(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(url.hostname);
}
function mediaTypeFromMime(mime?: string): MediaType {
  return mime?.startsWith('video/') ? 'video' : mime?.startsWith('audio/') ? 'audio' : 'unknown';
}
function mimeFromExtension(ext: string): string | undefined {
  return (
    {
      mp4: 'video/mp4',
      webm: 'video/webm',
      mkv: 'video/x-matroska',
      mov: 'video/quicktime',
      mp3: 'audio/mpeg',
      m4a: 'audio/mp4',
      wav: 'audio/wav',
      ogg: 'audio/ogg',
      flac: 'audio/flac',
    } as Record<string, string>
  )[ext.toLowerCase()];
}
async function runYtDlp(
  args: string[],
  onProgress?: (progress: { percent?: number; message: string }) => void,
): Promise<string> {
  onProgress?.({ message: 'Preparing YouTube downloader…' });
  const binaryPath = await ensureManagedYtDlp();
  return new Promise((resolve, reject) => {
    // yt-dlp needs a JavaScript runtime in Node-only containers.
    const fullArgs = ['--js-runtimes', 'nodejs:node', ...args];
    const child = spawn(binaryPath, fullArgs, { shell: false });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, 120_000);
    child.stdout.on('data', (data) => {
      stdout += String(data);
    });
    child.stderr.on('data', (data) => {
      const text = String(data);
      stderr += text;
      const percent = text.match(/(\d+(?:\.\d+)?)%/);
      if (percent) {
        onProgress?.({
          percent: Math.min(99, Math.max(1, Math.round(Number(percent[1])))),
          message: `Downloading video… ${percent[1]}%`,
        });
      }
    });
    (child as any).on('error', (error: NodeJS.ErrnoException) =>
      reject(
        error.code === 'ENOENT'
          ? new Error('The built-in YouTube downloader could not be started. Try importing again.')
          : error,
      ),
    );
    (child as any).on('close', (code: number | null) => {
      clearTimeout(timeout);
      if (code === 0) return resolve(stdout.trim());
      if (timedOut)
        return reject(
          new Error(
            'Video download timed out after 2 minutes. Try a shorter video or a direct media link.',
          ),
        );
      return reject(new Error(`yt-dlp failed (${code}): ${stderr.trim()}`));
    });
  });
}
