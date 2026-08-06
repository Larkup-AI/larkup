'use client';

import { useMemo, useState } from 'react';
import { Image as ImageIcon, Film, AudioLines, Maximize2, X } from 'lucide-react';

/**
 * Inline media preview for chat messages.
 *
 * Renders a compact preview of media referenced in assistant responses:
 * - Images: thumbnail with lightbox expand
 * - Video: compact player with timestamp range
 * - Audio: mini player bar
 */

export function ChatMediaPreview({
  assetId,
  mediaType,
  fileName,
  mediaUrl,
  sourceUrl,
  startSecs,
  endSecs,
}: {
  assetId: string;
  mediaType: 'image' | 'video' | 'audio' | 'frame-preview';
  fileName?: string;
  mediaUrl?: string;
  sourceUrl?: string;
  startSecs?: number;
  endSecs?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [imageUnavailable, setImageUnavailable] = useState(false);
  // Media is rendered only from a server-validated presentMedia result. Do
  // not invent a URL from an identifier emitted in model text: it could point
  // to a missing or unrelated asset and creates the misleading dummy preview
  // shown in the previous chat experience.
  const assetUrl = mediaUrl;
  if (!assetUrl) return null;
  const playbackUrl =
    startSecs !== undefined
      ? `${assetUrl.split('#')[0]}#t=${startSecs}${endSecs !== undefined ? `,${endSecs}` : ''}`
      : assetUrl;
  const providerEmbedUrl = useMemo(
    () => (mediaType === 'video' ? getProviderEmbedUrl(sourceUrl, startSecs) : undefined),
    [mediaType, sourceUrl, startSecs],
  );

  if (mediaType === 'image') {
    if (imageUnavailable) {
      return (
        <div className="my-2 w-full max-w-xl rounded-lg border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">This source image is no longer available.</p>
          <MediaCitationFooter
            icon={<ImageIcon className="size-3 text-muted-foreground" />}
            fileName={fileName}
            sourceUrl={sourceUrl}
          />
        </div>
      );
    }
    return (
      <>
        <div className="my-2 w-full max-w-xl overflow-hidden rounded-lg border border-border bg-card">
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="group relative block w-full overflow-hidden"
          >
            <img
              src={assetUrl}
              alt={fileName ?? 'Image'}
              className="max-h-105 w-full object-contain"
              loading="lazy"
              onError={() => setImageUnavailable(true)}
            />
            <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/20 group-hover:opacity-100">
              <Maximize2 className="size-5 text-white" />
            </div>
          </button>
          <MediaCitationFooter
            icon={<ImageIcon className="size-3 text-muted-foreground" />}
            fileName={fileName}
            sourceUrl={sourceUrl}
          />
        </div>

        {expanded && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-8"
            onClick={() => setExpanded(false)}
          >
            <button
              type="button"
              aria-label="Close image preview"
              className="absolute right-4 top-4 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
              onClick={() => setExpanded(false)}
            >
              <X className="size-5" />
            </button>
            <img
              src={assetUrl}
              alt={fileName ?? 'Image'}
              className="max-h-[80vh] max-w-[90vw] rounded-lg object-contain"
              onClick={(event) => event.stopPropagation()}
              onError={() => setImageUnavailable(true)}
            />
          </div>
        )}
      </>
    );
  }

  if (mediaType === 'video') {
    return (
      <div className="my-2 w-full max-w-xl overflow-hidden rounded-lg border border-border bg-card">
        {providerEmbedUrl ? (
          <iframe
            src={providerEmbedUrl}
            title={fileName ? `Watch ${fileName}` : 'Video preview'}
            className="aspect-video w-full bg-black"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        ) : (
          <video
            src={playbackUrl}
            controls
            playsInline
            preload="metadata"
            className="max-h-90 w-full bg-black object-contain"
          />
        )}
        <MediaCitationFooter
          icon={<Film className="size-3 text-muted-foreground" />}
          fileName={fileName}
          sourceUrl={sourceUrl}
          timestamp={
            startSecs !== undefined
              ? `${formatTimestamp(startSecs)}${
                  endSecs !== undefined ? ` – ${formatTimestamp(endSecs)}` : ''
                }`
              : undefined
          }
        />
      </div>
    );
  }

  if (mediaType === 'audio') {
    return (
      <div className="my-2 w-full max-w-xl overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex items-center gap-2.5 border-b border-border px-3 py-2">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <AudioLines className="size-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] font-medium text-foreground">
              {fileName ?? 'Audio recording'}
            </p>
            {startSecs !== undefined ? (
              <p className="mt-0.5 text-[10px] tabular-nums text-muted-foreground">
                {formatTimestamp(startSecs)}
                {endSecs !== undefined ? ` – ${formatTimestamp(endSecs)}` : ''}
              </p>
            ) : (
              <p className="mt-0.5 text-[10px] text-muted-foreground">Audio reference</p>
            )}
          </div>
        </div>
        <div className="px-3 py-2">
          <audio src={playbackUrl} controls preload="metadata" className="h-8 w-full" />
        </div>
        {sourceUrl ? (
          <div className="flex justify-end border-t border-border px-3 py-1.5">
            <a
              href={sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] font-medium text-primary hover:text-primary/80"
            >
              Open source
            </a>
          </div>
        ) : null}
      </div>
    );
  }

  if (mediaType === 'frame-preview') {
    if (imageUnavailable) {
      return (
        <div className="my-2 w-full max-w-xl rounded-lg border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">This frame could not be extracted.</p>
          <MediaCitationFooter
            icon={<Film className="size-3 text-muted-foreground" />}
            fileName={fileName}
            sourceUrl={sourceUrl}
            timestamp={startSecs !== undefined ? formatTimestamp(startSecs) : undefined}
          />
        </div>
      );
    }
    return (
      <>
        <div className="my-2 w-full max-w-xl overflow-hidden rounded-lg border border-border bg-card">
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="group relative block w-full overflow-hidden"
          >
            <img
              src={assetUrl}
              alt={`Frame at ${startSecs !== undefined ? formatTimestamp(startSecs) : 'unknown'}`}
              className="max-h-105 w-full object-contain"
              loading="lazy"
              onError={() => setImageUnavailable(true)}
            />
            {startSecs !== undefined && (
              <div className="absolute bottom-2 left-2 rounded-md bg-black/70 px-2 py-0.5">
                <span className="text-[11px] font-medium tabular-nums text-white">
                  {formatTimestamp(startSecs)}
                </span>
              </div>
            )}
            <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/20 group-hover:opacity-100">
              <Maximize2 className="size-5 text-white" />
            </div>
          </button>
          <MediaCitationFooter
            icon={<Film className="size-3 text-muted-foreground" />}
            fileName={fileName ? `${fileName} — Frame` : 'Video Frame'}
            sourceUrl={sourceUrl}
            timestamp={startSecs !== undefined ? formatTimestamp(startSecs) : undefined}
          />
        </div>

        {expanded && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-8"
            onClick={() => setExpanded(false)}
          >
            <button
              type="button"
              aria-label="Close frame preview"
              className="absolute right-4 top-4 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
              onClick={() => setExpanded(false)}
            >
              <X className="size-5" />
            </button>
            <img
              src={assetUrl}
              alt={`Frame at ${startSecs !== undefined ? formatTimestamp(startSecs) : 'unknown'}`}
              className="max-h-[80vh] max-w-[90vw] rounded-lg object-contain"
              onClick={(event) => event.stopPropagation()}
              onError={() => setImageUnavailable(true)}
            />
          </div>
        )}
      </>
    );
  }

  return null;
}

/**
 * Use a first-party embed only for providers with a known safe player. All
 * other URLs fall back to the locally indexed asset, which also keeps private
 * uploads and direct video links reliable in chat.
 */
export function getProviderEmbedUrl(sourceUrl?: string, startSecs?: number): string | undefined {
  if (!sourceUrl) return undefined;

  try {
    const url = new URL(sourceUrl);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const start = Math.max(0, Math.floor(startSecs ?? 0));

    if (host === 'youtu.be' || host.endsWith('.youtu.be')) {
      const videoId = url.pathname.split('/').filter(Boolean)[0];
      return videoId
        ? `https://www.youtube-nocookie.com/embed/${videoId}?start=${start}&rel=0`
        : undefined;
    }

    if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
      const pathParts = url.pathname.split('/').filter(Boolean);
      const videoId =
        url.searchParams.get('v') ||
        (['embed', 'shorts', 'live'].includes(pathParts[0]) ? pathParts[1] : undefined);
      return videoId
        ? `https://www.youtube-nocookie.com/embed/${videoId}?start=${start}&rel=0`
        : undefined;
    }

    if (host === 'vimeo.com' || host.endsWith('.vimeo.com')) {
      const videoId = url.pathname.split('/').find((part) => /^\d+$/.test(part));
      return videoId ? `https://player.vimeo.com/video/${videoId}#t=${start}s` : undefined;
    }
  } catch {
    // The local media URL remains the reliable fallback for malformed or
    // unsupported provider URLs.
  }

  return undefined;
}

function MediaCitationFooter({
  icon,
  fileName,
  sourceUrl,
  timestamp,
}: {
  icon: React.ReactNode;
  fileName?: string;
  sourceUrl?: string;
  timestamp?: string;
}) {
  if (!fileName && !sourceUrl && !timestamp) return null;

  return (
    <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-1.5">
      <div className="flex min-w-0 items-center gap-1.5">
        {icon}
        <span className="truncate text-[11px] text-muted-foreground">
          {fileName ?? 'Media citation'}
          {timestamp ? ` · ${timestamp}` : ''}
        </span>
      </div>
      {sourceUrl ? (
        <a
          href={sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-[11px] font-medium text-primary hover:text-primary/80"
        >
          Open source
        </a>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Markdown media reference parser                                     */
/* ------------------------------------------------------------------ */

/**
 * Parse media references from assistant text.
 *
 * Supported formats:
 * - [IMAGE_REF:assetId]
 * - [IMAGE_REF:assetId:fileName]
 * - [VIDEO_REF:assetId:startSecs-endSecs]
 * - [AUDIO_REF:assetId]
 */
const MEDIA_REF_REGEX = /\[(IMAGE_REF|VIDEO_REF|AUDIO_REF):([a-f0-9-]+)(?::([^\]]*))?\]/g;

export interface ParsedMediaRef {
  fullMatch: string;
  type: 'image' | 'video' | 'audio';
  assetId: string;
  extra?: string;
  startSecs?: number;
  endSecs?: number;
}

export function parseMediaRefs(text: string): ParsedMediaRef[] {
  const refs: ParsedMediaRef[] = [];
  let match: RegExpExecArray | null;

  while ((match = MEDIA_REF_REGEX.exec(text)) !== null) {
    const [fullMatch, refType, assetId, extra] = match;
    const type = refType === 'IMAGE_REF' ? 'image' : refType === 'VIDEO_REF' ? 'video' : 'audio';

    let startSecs: number | undefined;
    let endSecs: number | undefined;

    if ((type === 'video' || type === 'audio') && extra?.includes('-')) {
      const [s, e] = extra.split('-').map(Number);
      if (!isNaN(s)) startSecs = s;
      if (!isNaN(e)) endSecs = e;
    }

    refs.push({ fullMatch, type, assetId, extra, startSecs, endSecs });
  }

  return refs;
}

function formatTimestamp(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
