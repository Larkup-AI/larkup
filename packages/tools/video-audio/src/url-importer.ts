import { spawn } from 'node:child_process';
import { createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { randomUUID } from 'node:crypto';

import type { TranscriptionResult, TranscriptChunk } from './audio-processor.js';

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

export async function inspectMediaUrl(url: string): Promise<UrlInspection> {
  const parsed = validHttpUrl(url);
  if (isYouTube(parsed)) {
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
      durationSecs: data.duration ?? entries.reduce((sum, entry) => sum + (entry.duration ?? 0), 0),
      entryCount: Math.max(entries.length, 1),
      mediaType: 'video',
      isYouTube: true,
    };
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
    const output = await runYtDlp([
      '--no-progress',
      '--playlist-end',
      String(options.playlistMax ?? 10),
      '--format',
      'bestvideo[height<=480]+bestaudio/best[height<=480]/best',
      '--merge-output-format',
      'mp4',
      '-o',
      template,
      '--print',
      `after_move:${print}`,
      url,
    ]);
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
        sourceTranscript: await fetchYouTubeTranscript(item.originalUrl).catch(() => undefined),
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

/**
 * Read the video's own manual or automatic captions through yt-dlp. This is
 * both faster and usually more accurate than transcribing compressed audio,
 * especially for names and non-English speech.
 */
async function fetchYouTubeTranscript(url: string): Promise<TranscriptionResult | undefined> {
  const output = await runYtDlp(['--dump-single-json', '--skip-download', '--no-playlist', url]);
  const data = JSON.parse(output) as {
    duration?: number;
    language?: string;
    subtitles?: Record<string, SubtitleFormat[]>;
    automatic_captions?: Record<string, SubtitleFormat[]>;
  };
  const selected =
    selectSubtitleTrack(data.subtitles, data.language) ??
    selectSubtitleTrack(data.automatic_captions, data.language);
  if (!selected) return undefined;

  const response = await fetch(selected.url);
  if (!response.ok) throw new Error(`YouTube captions download failed (${response.status})`);
  const transcript = parseYouTubeJson3Transcript(await response.json(), data.duration ?? 0);
  return transcript.chunks.length > 0 ? transcript : undefined;
}

interface SubtitleFormat {
  ext?: string;
  url?: string;
}

function selectSubtitleTrack(
  tracks: Record<string, SubtitleFormat[]> | undefined,
  language: string | undefined,
): { url: string } | undefined {
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
    if (format?.url) return { url: format.url };
  }
  return undefined;
}

/** Parse YouTube's timestamped json3 caption format into indexing chunks. */
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
function runYtDlp(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('yt-dlp', args, { shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => {
      stdout += String(data);
    });
    child.stderr.on('data', (data) => {
      stderr += String(data);
    });
    (child as any).on('error', (error: NodeJS.ErrnoException) =>
      reject(
        error.code === 'ENOENT'
          ? new Error(
              'yt-dlp is required for YouTube URLs. Install it from https://github.com/yt-dlp/yt-dlp#installation',
            )
          : error,
      ),
    );
    (child as any).on('close', (code: number | null) =>
      code === 0
        ? resolve(stdout.trim())
        : reject(new Error(`yt-dlp failed (${code}): ${stderr.trim()}`)),
    );
  });
}
