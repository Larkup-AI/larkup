'use client';

import { useState } from 'react';
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
  startSecs,
  endSecs,
}: {
  assetId: string;
  mediaType: 'image' | 'video' | 'audio';
  fileName?: string;
  startSecs?: number;
  endSecs?: number;
}) {
  const [expanded, setExpanded] = useState(false);

  if (mediaType === 'image') {
    return (
      <>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="group relative my-2 inline-block w-full overflow-hidden rounded-lg border border-border"
        >
          <img
            src={`/api/media/${assetId}`}
            alt={fileName ?? 'Image'}
            className="h-auto w-full object-cover"
            loading="lazy"
          />
          <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 group-hover:bg-black/20 group-hover:opacity-100 transition-all">
            <Maximize2 className="size-5 text-white" />
          </div>
        </button>

        {/* Lightbox */}
        {expanded && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-8"
            onClick={() => setExpanded(false)}
          >
            <button
              type="button"
              className="absolute right-4 top-4 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
              onClick={() => setExpanded(false)}
            >
              <X className="size-5" />
            </button>
            <img
              src={`/api/media/${assetId}`}
              alt={fileName ?? 'Image'}
              className="max-h-[80vh] max-w-[90vw] rounded-lg object-contain"
            />
          </div>
        )}
      </>
    );
  }

  if (mediaType === 'video') {
    return (
      <div className="my-2 w-full overflow-hidden rounded-lg border border-border bg-card">
        <video
          src={`/api/media/${assetId}${
            startSecs !== undefined
              ? `#t=${startSecs}${endSecs !== undefined ? `,${endSecs}` : ''}`
              : ''
          }`}
          controls
          preload="metadata"
          className="w-full"
        />
        {fileName && (
          <div className="flex items-center gap-1.5 border-t border-border px-3 py-1.5">
            <Film className="size-3 text-muted-foreground" />
            <span className="truncate text-[11px] text-muted-foreground">
              {fileName}
              {startSecs !== undefined &&
                ` · ${formatTimestamp(startSecs)}${
                  endSecs ? ` – ${formatTimestamp(endSecs)}` : ''
                }`}
            </span>
          </div>
        )}
      </div>
    );
  }

  if (mediaType === 'audio') {
    return (
      <div className="my-2 w-full overflow-hidden rounded-lg border border-border bg-card">
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
          <audio
            src={`/api/media/${assetId}${
              startSecs !== undefined
                ? `#t=${startSecs}${endSecs !== undefined ? `,${endSecs}` : ''}`
                : ''
            }`}
            controls
            preload="metadata"
            className="h-8 w-full"
          />
        </div>
      </div>
    );
  }

  return null;
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
