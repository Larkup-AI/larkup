'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, ExternalLink, FileText, Play, TriangleAlert } from 'lucide-react';
import { ChatMediaPreview } from './chat-media-preview';

export interface ChatCitationItem {
  label: string;
  detail?: string;
  timestampSecs?: number;
  seekUrl?: string;
  conflicted?: boolean;
}

export interface ChatCitationsUi {
  kind: 'citations';
  title?: string;
  mediaUrl?: string;
  mediaType?: 'video' | 'audio';
  fileName?: string;
  primaryTimestampSecs?: number;
  items: ChatCitationItem[];
}

function formatTimestamp(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`;
}

/**
 * Generic citation list + optional supporting clip, part of the same
 * host-generic `output.ui.kind` contract as notice/card/table
 * (message-item.tsx) -- any tool can return this shape, not just video ones.
 * The first assistant message may opt into opening one supporting clip. All
 * later clips remain compact references until the user opens them.
 */
export function ChatCitations({
  ui,
  assetId,
  autoOpenSupportingClip = false,
}: {
  ui: ChatCitationsUi;
  assetId?: string;
  autoOpenSupportingClip?: boolean;
}) {
  const [clipOpen, setClipOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  useEffect(() => {
    setClipOpen(!!(autoOpenSupportingClip && ui.mediaUrl));
  }, [autoOpenSupportingClip, ui.mediaUrl]);
  if (!ui.items?.length && !ui.mediaUrl) return null;

  return (
    <div className="mb-1 w-full max-w-2xl" data-testid="chat-citations">
      {ui.mediaUrl ? (
        <div className="mb-2">
          <button
            type="button"
            onClick={() => setClipOpen((open) => !open)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <Play className="size-3" />
            <span className="font-medium">{clipOpen ? 'Hide' : 'Watch'} supporting clip</span>
            {typeof ui.primaryTimestampSecs === 'number' ? (
              <span>· starts at {formatTimestamp(ui.primaryTimestampSecs)}</span>
            ) : null}
          </button>
          {clipOpen ? (
            <div className="mt-1.5">
              <ChatMediaPreview
                assetId={assetId ?? 'chat-citation'}
                mediaType={ui.mediaType ?? 'video'}
                fileName={ui.fileName}
                mediaUrl={ui.mediaUrl}
                sourceUrl={ui.mediaUrl}
                startSecs={ui.primaryTimestampSecs}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {ui.items?.length ? (
        <div className="overflow-hidden rounded-lg border border-border/70 bg-card/60">
          <button
            type="button"
            onClick={() => setSourcesOpen((open) => !open)}
            className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs transition-colors hover:bg-muted/40"
            aria-expanded={sourcesOpen}
          >
            <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
              <FileText className="size-3.5 shrink-0" />
              <span className="font-medium text-foreground">{ui.title ?? 'Sources'}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
              {ui.items.length} citation{ui.items.length === 1 ? '' : 's'}
              {sourcesOpen ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
            </span>
          </button>

          {sourcesOpen ? (
            <div className="border-t border-border/60 px-2 py-1.5">
              {ui.items.map((item, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 rounded-md px-1.5 py-2 hover:bg-muted/40"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {typeof item.timestampSecs === 'number' ? (
                        <span className="text-[11px] font-semibold tabular-nums text-foreground">
                          {formatTimestamp(item.timestampSecs)}
                        </span>
                      ) : null}
                      <span className="text-[10px] text-muted-foreground">{item.label}</span>
                      {item.conflicted ? (
                        <TriangleAlert
                          className="size-3 shrink-0 text-amber-600 dark:text-amber-400"
                          aria-label="Conflicting evidence"
                        />
                      ) : null}
                    </div>
                  </div>
                  {item.seekUrl ? (
                    <a
                      href={item.seekUrl}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Open source: ${item.label}`}
                      className="mt-0.5 shrink-0 p-1 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <ExternalLink className="size-3.5" />
                    </a>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
