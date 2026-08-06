'use client';

import { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Eye,
  FileText,
  Mic,
  MonitorSmartphone,
  ShieldCheck,
  TriangleAlert,
  Type,
} from 'lucide-react';
import { ChatMediaPreview } from './chat-media-preview';

interface Evidence {
  evidenceId: string;
  modality: string;
  text: string;
  startSecs: number;
  endSecs: number;
  precision: string;
  confidence?: { score?: number; uncertaintyReasons?: string[] };
  conflicted?: boolean;
}

interface VideoEvidenceOutput {
  success?: boolean;
  mediaAssetId?: string;
  fileName?: string;
  sourceUrl?: string;
  originalUrl?: string;
  verification?: { status?: 'supported' | 'conflicted' | 'insufficient' | 'needs_inspection' };
  evidence?: Evidence[];
}

function parseOutput(value: unknown): VideoEvidenceOutput | undefined {
  if (typeof value === 'string') {
    try {
      return parseOutput(JSON.parse(value));
    } catch {
      return undefined;
    }
  }
  return value && typeof value === 'object' ? (value as VideoEvidenceOutput) : undefined;
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

function formatTimeRange(startSecs: number, endSecs: number) {
  if (Math.abs(startSecs - endSecs) < 1) return formatTimestamp(startSecs);
  return `${formatTimestamp(startSecs)}–${formatTimestamp(endSecs)}`;
}

/** Icon for the evidence modality. */
function ModalityIcon({ modality }: { modality: string }) {
  switch (modality) {
    case 'transcript':
      return <Mic className="size-3" />;
    case 'ocr':
      return <Type className="size-3" />;
    case 'visual':
      return <Eye className="size-3" />;
    default:
      return <MonitorSmartphone className="size-3" />;
  }
}

/** Human-readable modality label (no technical jargon). */
function modalityLabel(modality: string) {
  switch (modality) {
    case 'transcript':
      return 'Speech';
    case 'ocr':
      return 'On-screen text';
    case 'visual':
      return 'Visual';
    case 'audio-event':
      return 'Audio';
    case 'computed':
      return 'Analysis';
    default:
      return 'Evidence';
  }
}

/** Build a URL that seeks to the timestamp. */
function buildSeekUrl(output: VideoEvidenceOutput, startSecs: number): string | undefined {
  // For YouTube videos, link directly to the timestamp.
  const originalUrl = output.originalUrl;
  if (originalUrl) {
    try {
      const url = new URL(originalUrl);
      if (url.hostname.includes('youtube.com') || url.hostname.includes('youtu.be')) {
        url.searchParams.set('t', String(Math.floor(startSecs)));
        return url.toString();
      }
    } catch {}
  }
  // For local/uploaded videos, use the media API with timestamp.
  if (output.sourceUrl) {
    return `${output.sourceUrl}${output.sourceUrl.includes('?') ? '&' : '?'}t=${startSecs}`;
  }
  return undefined;
}

/**
 * A single, automatically selected supporting clip plus an expandable source
 * list. The evidence tool is ranked server-side, so the first unconflicted
 * result is the strongest source to embed without making the user choose a
 * moment or changing any tool behaviour.
 */
export function VideoEvidenceResult({ parts }: { parts: any[] }) {
  const [sourcesOpen, setSourcesOpen] = useState(false);

  const output = parts
    .map((part) =>
      parseOutput(
        part.type === 'tool-invocation' ? part.toolInvocation?.result : part.output ?? part.result,
      ),
    )
    .find((value) => value?.success && Array.isArray(value.evidence));
  if (!output?.evidence?.length) return null;

  const visibleEvidence = output.evidence.slice(0, 8);
  const supportingEvidence = output.evidence.filter(
    (evidence) =>
      !evidence.conflicted &&
      Number.isFinite(evidence.startSecs) &&
      Number.isFinite(evidence.endSecs),
  );
  const primaryEvidence = supportingEvidence[0];
  const canEmbedSupportingClip =
    output.verification?.status === 'supported' && Boolean(primaryEvidence && output.sourceUrl);

  return (
    <div className="mb-1 w-full max-w-2xl" data-testid="video-evidence-citations">
      {canEmbedSupportingClip && primaryEvidence ? (
        <div className="mb-2">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5 text-emerald-600 dark:text-emerald-400" />
            <span className="font-medium text-foreground">Supporting clip</span>
            <span className="text-muted-foreground">
              · starts at {formatTimestamp(primaryEvidence.startSecs)}
            </span>
          </div>
          <ChatMediaPreview
            assetId={output.mediaAssetId ?? 'video-evidence'}
            mediaType="video"
            fileName={output.fileName}
            mediaUrl={output.sourceUrl}
            sourceUrl={buildSeekUrl(output, primaryEvidence.startSecs)}
            startSecs={primaryEvidence.startSecs}
            endSecs={primaryEvidence.endSecs}
          />
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-border/70 bg-card/60">
        <button
          type="button"
          onClick={() => setSourcesOpen((open) => !open)}
          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs transition-colors hover:bg-muted/40"
          aria-expanded={sourcesOpen}
        >
          <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
            <FileText className="size-3.5 shrink-0" />
            <span className="font-medium text-foreground">Sources</span>
            {output.fileName ? <span className="truncate">· {output.fileName}</span> : null}
          </span>
          <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
            {output.evidence.length} citation{output.evidence.length === 1 ? '' : 's'}
            {sourcesOpen ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
          </span>
        </button>

        {sourcesOpen ? (
          <div className="border-t border-border/60 px-2 py-1.5">
            {visibleEvidence.map((evidence) => {
              const seekUrl = buildSeekUrl(output, evidence.startSecs);
              return (
                <div
                  key={evidence.evidenceId}
                  className="flex items-start gap-2 rounded-md px-1.5 py-2 hover:bg-muted/40"
                >
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
                    <ModalityIcon modality={evidence.modality} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold tabular-nums text-foreground">
                        {formatTimeRange(evidence.startSecs, evidence.endSecs)}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {modalityLabel(evidence.modality)}
                      </span>
                      {evidence.conflicted ? (
                        <TriangleAlert
                          className="size-3 shrink-0 text-amber-600 dark:text-amber-400"
                          aria-label="Conflicting evidence"
                        />
                      ) : null}
                    </div>
                    {evidence.text ? (
                      <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                        {evidence.text}
                      </p>
                    ) : null}
                  </div>
                  {seekUrl ? (
                    <a
                      href={seekUrl}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Open source at ${formatTimestamp(evidence.startSecs)}`}
                      className="mt-0.5 shrink-0 p-1 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <ExternalLink className="size-3.5" />
                    </a>
                  ) : null}
                </div>
              );
            })}
            {output.evidence.length > visibleEvidence.length ? (
              <p className="px-1.5 pt-1 text-[10px] text-muted-foreground">
                Showing the first {visibleEvidence.length} citations.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
