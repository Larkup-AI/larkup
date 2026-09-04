'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import type { UIMessage } from 'ai';
import { MessageActions } from '@/components/chat/message-actions';
import { ChatChart, type ChartConfig } from '@/components/chat/tools/chat-chart';
import { ChatDataTable, type DataTableConfig } from '@/components/chat/tools/chat-data-table';
import {
  ChatSandboxResult,
  type SandboxResultConfig,
} from '@/components/chat/tools/chat-sandbox-result';
import { ChatTabs } from '@/components/chat/tools/chat-tabs';
import {
  CorpusDataResult,
  type CorpusDataConfig,
} from '@/components/chat/tools/corpus-data-result';
import { ChatSignatureRequest } from '@/components/chat/tools/chat-signature-request';
import { Sparkles, FileEdit, CheckCircle2, Globe, ChevronDown } from 'lucide-react';
import { ChatMediaPreview } from '@/components/chat/tools/chat-media-preview';
import { ChatCitations, type ChatCitationsUi } from '@/components/chat/tools/chat-citations';
import { KnowledgeBaseResult } from '@/components/chat/tools/knowledge-base-result';
import { useDocEditor } from '@/components/chat/canvas/doc-editor-provider';
import { CHAT_TOOL_BEHAVIORS, getChatToolBehavior } from '@/lib/constants/tools';
import { decodeToolOutput } from '@/lib/chat/tool-output';
import {
  isIndeterminateProgress,
  keepToolProgressMonotonic,
  smoothLiveToolProgress,
  smoothPendingToolProgress,
  type LiveToolActivity,
} from '@/lib/chat/live-tool-progress';

export function MessageItem({
  message,
  isLast,
  isStreaming,
  addToolResult,
  serverId,
  autoOpenSupportingClip = false,
  regenerate,
  isBusy,
}: {
  message: UIMessage;
  isLast?: boolean;
  isStreaming?: boolean;
  addToolResult?: Function;
  serverId?: string | null;
  /** Only the first assistant message in a chat may expand a clip initially. */
  autoOpenSupportingClip?: boolean;
  regenerate?: (options?: { messageId?: string }) => void;
  /** True while a request is in flight — hides "Regenerate" on a trailing user message that's still waiting on a reply. */
  isBusy?: boolean;
}) {
  const isUser = message.role === 'user';
  const [progressClock, setProgressClock] = useState(() => Date.now());
  const pendingToolStartedAt = useRef<Record<string, number>>({});
  const [lastToolActivity, setLastToolActivity] = useState<LiveToolActivity | null>(null);
  const [toolProgressFloors, setToolProgressFloors] = useState<Record<string, number>>({});

  // The server gives us authoritative stage updates; this lightweight clock
  // only animates the safe in-between estimate above. It is scoped to the
  // active streamed answer so completed chat history never re-renders.
  useEffect(() => {
    if (!isLast || !isStreaming) return;
    setProgressClock(Date.now());
    const timer = window.setInterval(() => setProgressClock(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [isLast, isStreaming]);

  // Any long-running tool call (any installed tool, not just video) can
  // report live progress keyed by its own toolCallId -- see
  // gpu-activity-store.ts. Only the currently-streaming message ever has an
  // executing tool part, so there's nothing to match against otherwise.
  const { data: liveToolActivity } = useSWR<{ activity: LiveToolActivity | null }>(
    isLast && isStreaming
      ? `/api/gpu-activity${serverId ? `?projectId=${encodeURIComponent(serverId)}` : ''}`
      : null,
    (url: string) => fetch(url).then((r) => r.json()),
    {
      refreshInterval: 800,
      dedupingInterval: 0,
      keepPreviousData: true,
    },
  );
  const currentToolActivity =
    liveToolActivity?.activity?.toolCallId && liveToolActivity.activity.phase
      ? liveToolActivity.activity
      : lastToolActivity;
  const smoothedToolPercent = currentToolActivity
    ? smoothLiveToolProgress(currentToolActivity, progressClock)
    : 0;
  const priorToolPercent = currentToolActivity?.toolCallId
    ? toolProgressFloors[currentToolActivity.toolCallId]
    : undefined;
  const visibleToolPercent = keepToolProgressMonotonic(priorToolPercent, smoothedToolPercent);

  // A query may inspect several short source ranges in succession. The API
  // clears each finished range before the next starts, but they are one chat
  // action. Preserve its last visual floor and activity through that handoff
  // so the inline bar never drops back to the beginning.
  useEffect(() => {
    if (!liveToolActivity?.activity?.toolCallId) return;
    setLastToolActivity(liveToolActivity.activity);
    const callId = liveToolActivity.activity.toolCallId;
    const next = smoothLiveToolProgress(liveToolActivity.activity, progressClock);
    setToolProgressFloors((current) => {
      const floor = keepToolProgressMonotonic(current[callId], next);
      return current[callId] === floor ? current : { ...current, [callId]: floor };
    });
  }, [liveToolActivity?.activity, progressClock]);
  // Shown for both phases -- a silent "Working…" row for the whole time a
  // cold GPU worker takes to wake up reads as hung, even though the
  // dedicated bottom-right ring is also showing that same wait.
  const activeToolProgress = currentToolActivity?.toolCallId
    ? {
        toolCallId: currentToolActivity.toolCallId,
        percent: visibleToolPercent,
        label: currentToolActivity.label,
        message: currentToolActivity.message || currentToolActivity.label,
        phase: currentToolActivity.phase,
      }
    : null;

  let updateFromToolResult: ((result: any) => void) | undefined;
  let openCanvas: ((file: File, options?: any) => Promise<void>) | undefined;

  try {
    const editor = useDocEditor();
    updateFromToolResult = editor.updateFromToolResult;
    openCanvas = editor.openCanvas;
  } catch {}

  const anyMessage = message as any;
  const parts: any[] = useMemo(() => {
    const p: any[] = message.parts ? [...message.parts] : [];
    if (anyMessage.toolInvocations && Array.isArray(anyMessage.toolInvocations)) {
      anyMessage.toolInvocations.forEach((t: any) => {
        if (
          !p.some(
            (existing: any) =>
              existing.type === 'tool-invocation' &&
              existing.toolInvocation?.toolCallId === t.toolCallId,
          )
        ) {
          p.push({ type: 'tool-invocation', toolInvocation: t });
        }
      });
    }
    return p;
  }, [message.parts, anyMessage.toolInvocations]);

  const appliedToolCallsRef = useRef<Set<string>>(new Set());

  const docToolFingerprint = useMemo(() => {
    if (!isLast) return '';
    return parts
      .filter((p: any) => {
        const info = getToolInfo(p);
        return (
          info.isCompleted &&
          info.output?.success &&
          (info.toolName === 'fillDocumentForm' ||
            info.toolName === 'editDocument' ||
            info.toolName === 'requestDocumentSignature')
        );
      })
      .map((p: any) => {
        const ti = p.toolInvocation ?? p;
        return ti.toolCallId || ti.id || '';
      })
      .join(',');
  }, [parts, isLast]);

  useEffect(() => {
    if (!updateFromToolResult || !isLast || !docToolFingerprint) return;

    const completedDocTools = parts.filter((p: any) => {
      const info = getToolInfo(p);
      return (
        info.isCompleted &&
        info.output?.success &&
        (info.toolName === 'fillDocumentForm' ||
          info.toolName === 'editDocument' ||
          info.toolName === 'requestDocumentSignature')
      );
    });

    if (completedDocTools.length > 0) {
      completedDocTools.forEach((part: any) => {
        const ti = part.toolInvocation ?? part;
        const callId = ti.toolCallId || ti.id || '';

        // Skip if we already applied this specific tool result
        if (callId && appliedToolCallsRef.current.has(callId)) return;

        const output = getToolInfo(part).output;
        if (output && output.fileBase64) {
          if (callId) appliedToolCallsRef.current.add(callId);
          updateFromToolResult(output);
        }
      });
    }
  }, [docToolFingerprint, updateFromToolResult, isLast]);

  useEffect(() => {
    if (!isLast || !addToolResult) return;
    const signatureTools = parts.filter(
      (p: any) => getToolInfo(p).toolName === 'requestDocumentSignature',
    );
    if (signatureTools.length > 1) {
      // Keep the first one, auto-resolve the rest
      for (let i = 1; i < signatureTools.length; i++) {
        const info = getToolInfo(signatureTools[i]);
        if (info.isExecuting) {
          const ti = signatureTools[i].toolInvocation ?? signatureTools[i];
          const callId = ti.toolCallId || ti.id;
          if (callId && !appliedToolCallsRef.current.has(callId)) {
            appliedToolCallsRef.current.add(callId);
            addToolResult({
              toolCallId: callId,
              result: { success: true, message: 'Duplicate signature request auto-resolved.' },
            });
          }
        }
      }
    }
  }, [parts, isLast, addToolResult]);

  if (isUser) {
    const text = parts
      .filter((p: any) => p.type === 'text')
      .map((p: any) => p.text)
      .join('');

    const attachments = anyMessage.experimental_attachments || [];

    const partAttachments = parts
      .filter((p: any) => p.type === 'image' || p.type === 'file')
      .map((p: any) => {
        let name = p.name;
        let cType = p.mimeType || p.contentType || (p.type === 'image' ? 'image/png' : '');

        if (!cType && p.url && typeof p.url === 'string' && p.url.startsWith('data:')) {
          const match = p.url.match(/^data:([^;]+);/);
          if (match) cType = match[1];
        }
        if (!cType) cType = 'application/octet-stream';

        if (!name) {
          if (p.url && typeof p.url === 'string' && !p.url.startsWith('data:')) {
            name = p.url.split('/').pop()?.split('?')[0];
          } else {
            name = p.type === 'image' ? 'image.png' : 'Document';
            if (cType === 'application/pdf') name = 'Document.pdf';
            else if (cType === 'text/plain') name = 'Text.txt';
            else if (cType.includes('word')) name = 'Document.docx';
            else if (cType.includes('excel') || cType.includes('spreadsheet')) name = 'Data.xlsx';
          }
        }
        return {
          url: p.image || p.data || p.url,
          contentType: cType,
          name,
        };
      });

    // Deduplicate or combine (usually they are either in experimental_attachments or parts, rarely both)
    const allAttachments = attachments.length > 0 ? attachments : partAttachments;

    return (
      <div className="message user-message group flex justify-end" data-role="user">
        <div className="max-w-[85%] flex flex-col gap-2 items-end">
          {allAttachments.length > 0 && (
            <div className="flex flex-wrap justify-end gap-2">
              {allAttachments.map((att: any, i: number) => {
                let cType = att.contentType || att.type || '';
                const isImage = cType.startsWith('image/');
                const isVideo = cType.startsWith('video/');
                const isAudio = cType.startsWith('audio/');
                let nameStr = att.name;

                if (
                  !cType &&
                  att.url &&
                  typeof att.url === 'string' &&
                  att.url.startsWith('data:')
                ) {
                  const match = att.url.match(/^data:([^;]+);/);
                  if (match) cType = match[1];
                }

                // AI SDK sometimes loses the MIME type and defaults to application/octet-stream
                // We can sniff PDF magic bytes `%PDF-` -> `JVBERi0` in base64
                if (
                  (!cType || cType === 'application/octet-stream') &&
                  att.url &&
                  typeof att.url === 'string'
                ) {
                  if (att.url.includes('JVBERi0')) {
                    cType = 'application/pdf';
                  }
                }

                if (!nameStr || nameStr === 'Attachment') {
                  nameStr = isImage ? 'image.png' : 'Document';
                  if (cType === 'application/pdf') nameStr = 'Document.pdf';
                  else if (cType === 'text/plain') nameStr = 'Text.txt';
                  else if (cType.includes('word')) nameStr = 'Document.docx';
                  else if (cType.includes('excel') || cType.includes('spreadsheet'))
                    nameStr = 'Data.xlsx';
                } else if (cType === 'application/pdf' && !nameStr.toLowerCase().endsWith('.pdf')) {
                  nameStr += '.pdf';
                }

                const ext = nameStr.split('.').pop()?.toLowerCase() || '';
                let iconPath = '/icons/image.png'; // default fallback for images and unknown files
                if (
                  ['csv', 'xls', 'xlsx'].includes(ext) ||
                  cType.includes('excel') ||
                  cType.includes('spreadsheet')
                )
                  iconPath = '/icons/excel.png';
                else if (['doc', 'docx'].includes(ext) || cType.includes('word'))
                  iconPath = '/icons/word.png';
                else if (['md', 'markdown'].includes(ext)) iconPath = '/icons/markdown.png';
                else if (['pdf'].includes(ext) || cType === 'application/pdf')
                  iconPath = '/icons/pdf.png';
                else if (isVideo) iconPath = '/icons/video.png';
                else if (isAudio) iconPath = '/icons/audio.png';
                else if (!isImage && !ext) iconPath = '/icons/word.png'; // Generic file icon

                return (
                  <div
                    key={i}
                    onClick={() => {
                      if (openCanvas) {
                        if (att instanceof File || (att.name && att.size && !att.url)) {
                          // It's a File object provided directly from input
                          openCanvas(att as File, { background: false });
                        } else if (att.url) {
                          let fetchUrl = att.url;
                          // If it's a raw base64 string without data prefix, add it
                          if (!fetchUrl.startsWith('http') && !fetchUrl.startsWith('data:')) {
                            fetchUrl = `data:${
                              cType || 'application/octet-stream'
                            };base64,${fetchUrl}`;
                          }
                          fetch(fetchUrl)
                            .then((r) => r.blob())
                            .then((blob) => {
                              const file = new File([blob], nameStr, { type: cType });
                              openCanvas(file, { background: false });
                            })
                            .catch((err) => {
                              console.error('Failed to open attachment in canvas', err);
                            });
                        }
                      }
                    }}
                    className={`flex items-center gap-2 bg-muted/80 border border-border/60 rounded-xl h-12 px-3 p-1 shrink-0 ${
                      openCanvas && (att.url || att instanceof File || att.size)
                        ? 'cursor-pointer hover:bg-muted'
                        : ''
                    }`}
                  >
                    <div className="size-7 shrink-0 rounded-md overflow-hidden bg-background border border-border/90 flex items-center justify-center p-1">
                      <img src={iconPath} alt={nameStr} className="w-full h-full object-contain" />
                    </div>
                    <div className="flex flex-col justify-center max-w-37.5">
                      <span className="text-xs font-medium truncate text-foreground">
                        {nameStr}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {text && (
            <div className="rounded-2xl rounded-br-md bg-muted border border-border/25 px-4 py-2 text-[15px] leading-relaxed text-foreground">
              {text}
            </div>
          )}
          {text && (
            <MessageActions
              text={text}
              className="opacity-0 transition group-hover:opacity-100 focus-within:opacity-100"
              regenerateLabel="Resend from here"
              onRegenerate={
                !isBusy && regenerate ? () => regenerate({ messageId: message.id }) : undefined
              }
            />
          )}
        </div>
      </div>
    );
  }

  // Assistant message
  const kbParts = parts.filter((p: any) => {
    const { toolName } = getToolInfo(p);
    return getChatToolBehavior(toolName).placement === 'source';
  });
  // searchKnowledgeBase automatically enriches a video match with active
  // evidence (queryVideoKnowledge's own result, ui.kind:'citations' included
  // -- the same generic shape any tool's completed result can carry).
  // Preserve that nested result as a visible citation card instead of
  // making a completed GPU investigation look like ordinary RAG only.
  const nestedVideoCitationsUi: ChatCitationsUi[] = kbParts.flatMap((part: any) => {
    const output = getToolInfo(part).output;
    const result = decodeToolOutput(output) as any;
    return result?.videoEvidence?.success && result.videoEvidence.ui?.kind === 'citations'
      ? [result.videoEvidence.ui as ChatCitationsUi]
      : [];
  });
  const isKnowledgeSearchActive = kbParts.some((part: any) => getToolInfo(part).isExecuting);
  const activeKnowledgeProgress =
    activeToolProgress &&
    kbParts.some((part: any) => {
      const invocation = part.toolInvocation ?? part;
      return (invocation.toolCallId || invocation.id || '') === activeToolProgress.toolCallId;
    })
      ? activeToolProgress
      : null;

  let signatureFound = false;
  const toolParts = parts.filter((p: any) => {
    const { toolName } = getToolInfo(p);
    if (getChatToolBehavior(toolName).placement === 'source') return false;
    if (toolName === 'requestDocumentSignature') {
      if (signatureFound) return false;
      signatureFound = true;
    }
    return true;
  });

  const textParts = parts.filter((p: any) => p.type === 'text');

  const { allCleanTexts, hasThinkTags } = useMemo(() => {
    let hasTags = false;
    const cleanTexts: string[] = [];
    for (const part of textParts) {
      const raw = part.text || '';
      const { cleanText, reasoningText } = stripThinkTags(raw);
      cleanTexts.push(cleanText);
      if (reasoningText) {
        hasTags = true;
      }
    }
    return { allCleanTexts: cleanTexts, hasThinkTags: hasTags };
  }, [textParts]);

  const answerText = useMemo(
    () => allCleanTexts.filter(Boolean).join('\n\n').trim(),
    [allCleanTexts],
  );

  // Feedback is presentation state only. Answers are always regenerated from
  // fresh retrieval and are never saved as a shortcut for a later question.
  const [liked, setLiked] = useState(false);
  const [disliked, setDisliked] = useState(false);

  const handleLike = () => {
    setLiked((current) => !current);
    setDisliked(false);
  };

  const handleDislike = () => {
    const next = !disliked;
    setDisliked(next);
    if (next) setLiked(false);
  };

  const isShimmering =
    textParts.every((p: any) => !p.text || p.text.trim().length === 0) && isLast && isStreaming;

  const isVizPart = (p: any) => {
    const { toolName, isCompleted } = getToolInfo(p);
    return getChatToolBehavior(toolName).placement === 'visualization' && isCompleted;
  };

  const vizParts = toolParts.filter(isVizPart);
  const mediaToolParts = toolParts.filter(
    (p: any) => getChatToolBehavior(getToolInfo(p).toolName).placement === 'media',
  );
  const webSearchParts = toolParts.filter(
    (p: any) => getChatToolBehavior(getToolInfo(p).toolName).placement === 'web-search',
  );
  const nonVizToolParts = toolParts.filter((p: any) => {
    const placement = getChatToolBehavior(getToolInfo(p).toolName).placement;
    return !isVizPart(p) && placement === 'inline';
  });
  const firstCitationToolPartIndex = toolParts.findIndex(
    (part: any) => getToolInfo(part).output?.ui?.kind === 'citations',
  );

  const vizTabs =
    vizParts.length > 1
      ? vizParts.map((p: any, i: number) => {
          const { output } = getToolInfo(p);
          return {
            label: (output as ChartConfig)?.title || `Chart ${i + 1}`,
            content: renderToolPart(p, i),
          };
        })
      : null;

  const executingParts = useMemo(
    () =>
      toolParts.filter((p: any) => {
        const { isExecuting, toolName } = getToolInfo(p);
        return isExecuting && getChatToolBehavior(toolName).placement !== 'source';
      }),
    [toolParts],
  );
  const progressForExecutingPart = (part: any) => {
    const invocation = part.toolInvocation ?? part;
    const toolCallId = invocation.toolCallId || invocation.id || '';
    if (activeToolProgress?.toolCallId === toolCallId) return activeToolProgress;
    pendingToolStartedAt.current[toolCallId] ??= progressClock;
    const behavior = getChatToolBehavior(getToolInfo(part).toolName);
    return {
      toolCallId,
      percent: smoothPendingToolProgress(pendingToolStartedAt.current[toolCallId], progressClock),
      label: behavior.pendingLabel || 'Working…',
      message: behavior.pendingLabel || 'Working…',
    };
  };

  return (
    <div className="message assistant-message flex flex-col gap-2" data-role="assistant">
      {kbParts.length > 0 && (
        <KnowledgeBaseResult
          parts={kbParts}
          isShimmering={isShimmering}
          activity={activeKnowledgeProgress}
        />
      )}

      {nestedVideoCitationsUi.map((ui, i) => (
        <ChatCitations
          key={`nested-citations-${i}`}
          ui={ui}
          autoOpenSupportingClip={autoOpenSupportingClip && i === 0}
        />
      ))}

      {webSearchParts.length > 0 && <WebSearchSummary parts={webSearchParts} />}

      {nonVizToolParts
        .filter((p: any) => getToolInfo(p).isCompleted)
        .map((part: any, i: number) => {
          const partIndex = toolParts.indexOf(part);
          return renderToolPart(
            part,
            i,
            addToolResult,
            updateFromToolResult,
            undefined,
            autoOpenSupportingClip &&
              nestedVideoCitationsUi.length === 0 &&
              partIndex === firstCitationToolPartIndex,
          );
        })}

      {vizTabs ? (
        <ChatTabs config={{ tabs: vizTabs }} />
      ) : (
        vizParts.map((part: any, i: number) =>
          renderToolPart(part, i, addToolResult, updateFromToolResult),
        )
      )}

      {executingParts.map((part: any, i: number) =>
        renderToolPart(
          part,
          i,
          addToolResult,
          updateFromToolResult,
          progressForExecutingPart(part),
        ),
      )}

      {isLast &&
        isStreaming &&
        executingParts.length === 0 &&
        !isKnowledgeSearchActive &&
        !hasThinkTags &&
        textParts.every((p: any) => !p.text || p.text.trim().length === 0) && (
          <div className="flex items-center gap-2">
            <div className="size-6.5 bg-white border border-border rounded-full flex items-center justify-center p-1 animate-pulse">
              <img src="/logo.png" alt="logo" className="size-4 animate-spin" />
            </div>
          </div>
        )}

      {/* Text parts — with markdown table detection + think-tag stripping */}
      {textParts.map((part: any, i: number) => {
        const rawText = part.text || '';
        if (!rawText.trim()) return null;

        const strippedText = allCleanTexts[i] ?? rawText;
        const cleanText = strippedText.replace(/\[(?:IMAGE_REF|VIDEO_REF|AUDIO_REF):[^\]]+\]/g, '');

        if (!cleanText.trim()) return null;

        const segments = splitTextAndTables(cleanText);

        return (
          <div key={i} className="flex flex-col gap-4">
            {segments.map((seg, j) => {
              if (seg.type === 'table') {
                const tableConfig: DataTableConfig = {
                  columns: seg.table.columns,
                  rows: seg.table.rows,
                  totalRows: seg.table.rows.length,
                };
                return <ChatDataTable key={`table-${j}`} config={tableConfig} />;
              }
              return (
                <div
                  key={`text-${j}`}
                  className="assistant-text-content"
                  dangerouslySetInnerHTML={{
                    __html: renderMarkdown(seg.content),
                  }}
                />
              );
            })}
          </div>
        );
      })}

      {mediaToolParts
        .filter((p: any) => getToolInfo(p).isCompleted)
        .map((part: any, i: number) =>
          renderToolPart(part, i, addToolResult, updateFromToolResult),
        )}

      {answerText && !(isLast && isStreaming) && (
        <MessageActions
          text={answerText}
          liked={liked}
          disliked={disliked}
          onLike={handleLike}
          onDislike={handleDislike}
          onRegenerate={regenerate ? () => regenerate({ messageId: message.id }) : undefined}
        />
      )}
    </div>
  );
}

interface ParsedTable {
  columns: string[];
  rows: Record<string, any>[];
}

function splitTextAndTables(
  text: string,
): Array<{ type: 'text'; content: string } | { type: 'table'; table: ParsedTable }> {
  if (!text) return [];

  const lines = text.split('\n');
  const segments: Array<{ type: 'text'; content: string } | { type: 'table'; table: ParsedTable }> =
    [];
  let currentText: string[] = [];
  let tableLines: string[] = [];
  let inTable = false;

  const isTableRow = (line: string) => {
    const trimmed = line.trim();
    return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.length > 2;
  };

  const isSeparatorRow = (line: string) => /^\|[\s\-:|]+\|$/.test(line.trim());

  const flushText = () => {
    if (currentText.length > 0) {
      const content = currentText.join('\n').trim();
      if (content) {
        segments.push({ type: 'text', content });
      }
      currentText = [];
    }
  };

  const flushTable = () => {
    if (tableLines.length < 2) {
      currentText.push(...tableLines);
      tableLines = [];
      return;
    }

    const headerLine = tableLines[0];
    const columns = headerLine
      .split('|')
      .map((c) => c.trim())
      .filter(Boolean);

    let dataStart = 1;
    if (tableLines.length > 1 && isSeparatorRow(tableLines[1])) {
      dataStart = 2;
    }

    const rows: Record<string, any>[] = [];
    for (let i = dataStart; i < tableLines.length; i++) {
      const rawCells = tableLines[i]
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim());

      const row: Record<string, any> = {};
      columns.forEach((col, j) => {
        const val = rawCells[j] ?? '';
        const num = Number(val);
        row[col] = !isNaN(num) && val !== '' ? num : val;
      });
      rows.push(row);
    }

    if (columns.length > 0 && rows.length > 0) {
      segments.push({
        type: 'table',
        table: { columns, rows },
      });
    }
    tableLines = [];
  };

  for (const line of lines) {
    if (isTableRow(line)) {
      if (!inTable) {
        flushText();
        inTable = true;
      }
      if (!isSeparatorRow(line) || tableLines.length === 1) {
        tableLines.push(line);
      } else if (isSeparatorRow(line)) {
        tableLines.push(line);
      }
    } else {
      if (inTable) {
        flushTable();
        inTable = false;
      }
      currentText.push(line);
    }
  }

  if (inTable) {
    flushTable();
  }
  flushText();

  return segments;
}

function stripThinkTags(text: string): { cleanText: string; reasoningText: string } {
  if (!text) return { cleanText: '', reasoningText: '' };

  const reasoningParts: string[] = [];
  let cleaned = stripLeakedToolCalls(text);

  // 1. Extract complete <think>…</think> or <thought>…</thought> blocks
  const thinkRegex = /<(?:think|thought)>([\s\S]*?)<\/(?:think|thought)>/gi;
  let match;
  while ((match = thinkRegex.exec(cleaned)) !== null) {
    reasoningParts.push(match[1].trim());
  }
  cleaned = cleaned.replace(thinkRegex, '');

  // 2. Extract unclosed <think> or <thought> (streaming, no closing tag yet)
  const unclosedThinkRegex = /<(?:think|thought)>([\s\S]*)$/i;
  const unclosedThinkMatch = cleaned.match(unclosedThinkRegex);
  if (unclosedThinkMatch) {
    reasoningParts.push(unclosedThinkMatch[1].trim());
    cleaned = cleaned.replace(unclosedThinkRegex, '');
  }

  // 3. Handle <result>...</result>
  const resultRegex = /<result>([\s\S]*?)<\/result>/gi;
  let resultMatch;
  let foundResult = false;
  let finalCleanText = '';
  let textOutsideResult = cleaned;

  while ((resultMatch = resultRegex.exec(cleaned)) !== null) {
    foundResult = true;
    finalCleanText += (finalCleanText ? '\n\n' : '') + resultMatch[1].trim();
    textOutsideResult = textOutsideResult.replace(resultMatch[0], '');
  }

  // Handle unclosed <result>
  const unclosedResultRegex = /<result>([\s\S]*)$/i;
  const unclosedResultMatch = textOutsideResult.match(unclosedResultRegex);
  if (unclosedResultMatch) {
    foundResult = true;
    finalCleanText += (finalCleanText ? '\n\n' : '') + unclosedResultMatch[1].trim();
    textOutsideResult = textOutsideResult.replace(unclosedResultRegex, '');
  }

  if (foundResult) {
    if (textOutsideResult.trim()) {
      reasoningParts.push(textOutsideResult.trim());
    }
    return {
      cleanText: finalCleanText.trim(),
      reasoningText: reasoningParts.filter(Boolean).join('\n\n'),
    };
  }

  return {
    cleanText: cleaned.trim(),
    reasoningText: reasoningParts.filter(Boolean).join('\n\n'),
  };
}

/**
 * Some providers occasionally place a tool request in assistant text after
 * sending (or instead of sending) the structured tool part. Tool calls are
 * implementation detail, never useful answer content. Restrict removal to
 * registered first-party names so ordinary prose and code remain intact.
 */
function stripLeakedToolCalls(text: string): string {
  const names = new Set(Object.keys(CHAT_TOOL_BEHAVIORS));
  const lines = text.split('\n');
  const kept: string[] = [];
  let callDepth = 0;

  for (const line of lines) {
    if (callDepth > 0) {
      callDepth += countParentheses(line);
      if (callDepth <= 0) callDepth = 0;
      continue;
    }
    const name = line.match(/^\s*([A-Za-z_$][\w$]*)\s*\(/)?.[1];
    if (name && names.has(name)) {
      callDepth = countParentheses(line);
      if (callDepth <= 0) callDepth = 0;
      continue;
    }
    kept.push(line);
  }
  return kept.join('\n');
}

function countParentheses(text: string): number {
  let count = 0;
  for (const char of text) {
    if (char === '(') count += 1;
    if (char === ')') count -= 1;
  }
  return count;
}

function getToolInfo(part: any): {
  toolName: string;
  isExecuting: boolean;
  isCompleted: boolean;
  output: any;
  input: any;
} {
  if (part.type === 'tool-invocation') {
    const ti = part.toolInvocation;
    const state = ti.state;
    return {
      toolName: ti.toolName,
      isExecuting: state === 'partial-call' || state === 'call',
      isCompleted:
        (state === 'result' || state === 'output' || state === 'output-available') &&
        ti.result !== undefined,
      output: decodeToolOutput(ti.result) ?? ti.result,
      input: ti.args,
    };
  }

  if (part.type?.startsWith('tool-') && part.type !== 'tool-invocation') {
    const toolName = part.type.replace('tool-', '');
    const state = part.state;
    return {
      toolName,
      isExecuting: state === 'input-streaming' || state === 'input-available',
      isCompleted:
        (state === 'output' || state === 'output-available') && part.output !== undefined,
      output: decodeToolOutput(part.output) ?? part.output,
      input: part.input,
    };
  }

  return {
    toolName: '',
    isExecuting: false,
    isCompleted: false,
    output: undefined,
    input: undefined,
  };
}

function renderToolPart(
  part: any,
  index: number,
  addToolResult?: Function,
  updateFromToolResult?: Function,
  toolProgress?: {
    toolCallId: string;
    percent: number;
    label: string;
    message?: string;
  } | null,
  autoOpenSupportingClip = false,
): React.ReactNode | null {
  const { toolName, isExecuting, isCompleted, output, input } = getToolInfo(part);
  const behavior = getChatToolBehavior(toolName);
  const callId = part.toolInvocation?.toolCallId || part.toolCallId || part.id || '';

  if (isExecuting) {
    if (behavior.placement === 'source') return null;

    if (behavior.resultView === 'signature') {
      return (
        <ChatSignatureRequest
          key={index}
          detectedLocations={input?.detectedLocations}
          toolCallId={callId}
          addToolResult={addToolResult}
        />
      );
    }

    const liveProgress = toolProgress && toolProgress.toolCallId === callId ? toolProgress : null;
    // Past the point where the remaining work has a measurable size, a
    // percentage is a claim we cannot back. Drop it and shuttle the bar
    // instead, so the wait still reads as active rather than stalled.
    const indeterminate = liveProgress ? isIndeterminateProgress(liveProgress.percent) : false;

    return (
      <div key={index} className="flex flex-col gap-1.5 py-3">
        <div className="flex items-center gap-2">
          <div className="size-6.5 bg-white dark:bg-card border border-border rounded-full flex items-center justify-center p-1">
            <img src="/logo.png" alt="" className="size-4 animate-spin" />
          </div>
          <span className="larkup-shimmer-text text-[13px] font-medium">
            {liveProgress?.message || liveProgress?.label || behavior.pendingLabel || 'Working'}
          </span>
        </div>
        {liveProgress && behavior.showProgressBar !== false ? (
          <div className="ml-9 flex items-center gap-2">
            <div className="h-1.5 w-48 overflow-hidden rounded-full bg-muted">
              {indeterminate ? (
                <div className="larkup-progress-shuttle h-full rounded-full bg-emerald-500" />
              ) : (
                <div
                  className="h-full rounded-full bg-emerald-500 transition-[width] duration-700 ease-out"
                  style={{ width: `${Math.max(6, Math.min(100, liveProgress.percent))}%` }}
                />
              )}
            </div>
            {!indeterminate ? (
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {Math.round(liveProgress.percent)}%
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  if (isCompleted) {
    const enterpriseUi = output?.ui;
    if (enterpriseUi?.kind === 'notice') {
      return (
        <div
          key={index}
          className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm"
        >
          <div className="font-medium">{enterpriseUi.title}</div>
          <div className="mt-1 text-muted-foreground">{enterpriseUi.body}</div>
        </div>
      );
    }
    if (enterpriseUi?.kind === 'card') {
      return (
        <div key={index} className="rounded-xl border border-border bg-card px-4 py-3 text-sm">
          <div className="font-medium">{enterpriseUi.title}</div>
          <dl className="mt-3 grid gap-2">
            {(enterpriseUi.facts ?? []).map((fact: { label: string; value: string }) => (
              <div className="flex items-start justify-between gap-5" key={fact.label}>
                <dt className="text-muted-foreground">{fact.label}</dt>
                <dd className="text-right">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      );
    }
    if (enterpriseUi?.kind === 'table') {
      return (
        <div
          key={index}
          className="overflow-x-auto rounded-xl border border-border bg-card p-3 text-sm"
        >
          <div className="mb-3 font-medium">{enterpriseUi.title}</div>
          <table className="w-full text-left">
            <thead className="text-muted-foreground">
              <tr>
                {(enterpriseUi.columns ?? []).map((column: string) => (
                  <th className="px-2 py-1" key={column}>
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(enterpriseUi.rows ?? []).map((row: Record<string, string>, rowIndex: number) => (
                <tr className="border-t border-border/60" key={rowIndex}>
                  {(enterpriseUi.columns ?? []).map((column: string) => (
                    <td className="px-2 py-2" key={column}>
                      {row[column]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    if (enterpriseUi?.kind === 'citations') {
      return (
        <ChatCitations
          key={index}
          ui={enterpriseUi}
          assetId={output?.mediaAssetId}
          autoOpenSupportingClip={autoOpenSupportingClip}
        />
      );
    }
    switch (behavior.resultView) {
      case 'data-table': {
        if (output.error) return null;
        const tableConfig: DataTableConfig = {
          columns: output.columns ?? [],
          rows: output.rows ?? [],
          totalRows: output.totalRows ?? 0,
          aggregationResults: output.aggregationResults,
        };
        if (tableConfig.rows.length === 0 && !tableConfig.aggregationResults) return null;
        const visualization = output.visualization as ChartConfig | undefined;
        return (
          <div key={index}>
            <ChatDataTable config={tableConfig} compact={behavior.compactResult} />
            {visualization?.data?.length ? <ChatChart config={visualization} /> : null}
          </div>
        );
      }

      case 'none': {
        if (behavior.placement !== 'visualization') return null;
        const chartConfig = output as ChartConfig;
        if (!chartConfig?.data || chartConfig.data.length === 0) return null;
        return <ChatChart key={index} config={chartConfig} />;
      }

      case 'sandbox': {
        const result = output as SandboxResultConfig;
        const code = input?.code;
        return <ChatSandboxResult key={index} config={result} code={code} />;
      }

      case 'corpus': {
        const corpusConfig = output as CorpusDataConfig;
        if (!corpusConfig) return null;
        return <CorpusDataResult key={index} config={corpusConfig} />;
      }

      case 'document-edit': {
        if (!output.success) return null;

        const fileName = output.fileName || 'Document';
        const cType = output.mimeType || '';
        const ext = fileName.split('.').pop()?.toLowerCase() || '';
        let iconPath = '/icons/image.png'; // default fallback for images and unknown files
        if (
          ['csv', 'xls', 'xlsx'].includes(ext) ||
          cType.includes('excel') ||
          cType.includes('spreadsheet')
        )
          iconPath = '/icons/excel.png';
        else if (['doc', 'docx'].includes(ext) || cType.includes('word'))
          iconPath = '/icons/word.png';
        else if (['md', 'markdown'].includes(ext)) iconPath = '/icons/markdown.png';
        else if (['pdf'].includes(ext) || cType === 'application/pdf') iconPath = '/icons/pdf.png';
        else if (!ext) iconPath = '/icons/word.png';

        return (
          <div
            key={index}
            onClick={() => {
              if (updateFromToolResult && output.fileBase64) {
                updateFromToolResult(output);
              }
            }}
            className="group flex items-center gap-3 rounded-xl border border-border/60 bg-emerald-50/50 dark:bg-emerald-900/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400 cursor-pointer hover:bg-emerald-100/50 dark:hover:bg-emerald-900/20 transition"
          >
            <div className="size-8 shrink-0 rounded-md overflow-hidden bg-white border border-emerald-200/50 flex items-center justify-center p-1.5 35">
              <img src={iconPath} alt={fileName} className="w-full h-full object-contain" />
            </div>
            <div className="flex flex-col flex-1">
              <span className="font-medium text-emerald-800 dark:text-emerald-300">
                {toolName === 'fillDocumentForm' ? 'Form fields updated in ' : 'Edited '}
                <span className="font-bold">{fileName}</span>
              </span>
              <span className="text-xs opacity-80 mt-0.5">
                {output.updatedFields?.length || 0}{' '}
                {output.updatedFields?.length === 1 ? 'change' : 'changes'} applied. Preview updated
                in Canvas.
              </span>
            </div>
            {output.fileBase64 && (
              <div className="opacity-0 group-hover:opacity-100 text-xs font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1 transition">
                <FileEdit className="size-3" />
                View this version
              </div>
            )}
          </div>
        );
      }

      case 'signature': {
        if (!output?.success) return null;
        return (
          <div
            key={index}
            onClick={() => {
              if (updateFromToolResult && output.fileBase64) {
                updateFromToolResult(output);
              }
            }}
            className="group flex items-center gap-3 rounded-xl border border-border/60 bg-emerald-50/50 dark:bg-emerald-900/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400 mt-2 cursor-pointer hover:bg-emerald-100/50 dark:hover:bg-emerald-900/20 transition"
          >
            <CheckCircle2 className="size-5 shrink-0 text-emerald-500" />
            <div className="flex-1 flex items-center justify-between">
              <span className="font-medium text-emerald-800 dark:text-emerald-300">
                Document signed successfully.
              </span>
              {output.fileBase64 && (
                <div className="opacity-0 group-hover:opacity-100 text-xs font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1 transition">
                  <FileEdit className="size-3" />
                  View this version
                </div>
              )}
            </div>
          </div>
        );
      }

      case 'image-analysis': {
        if (output.error) return null;
        return (
          <div key={index} className="mb-2 w-full">
            <div className="inline-flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground bg-muted/30 rounded-md border border-border/50">
              <Sparkles className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate max-w-62.5 sm:max-w-100">Analyzed indexed image</span>
            </div>
          </div>
        );
      }

      case 'media': {
        if (
          !output?.success ||
          !output.assetId ||
          !['image', 'video', 'audio', 'frame-preview'].includes(output.mediaType)
        ) {
          return null;
        }
        return (
          <ChatMediaPreview
            key={index}
            assetId={output.assetId}
            mediaType={output.mediaType}
            fileName={output.fileName}
            mediaUrl={output.mediaUrl}
            sourceUrl={output.sourceUrl}
            startSecs={output.startSecs}
            endSecs={output.endSecs}
          />
        );
      }

      default:
        return null;
      // return (
      //   <div key={index} className="mb-2 w-full">
      //     <div className="inline-flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground bg-muted/30 rounded-md border border-border/50">
      //       <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
      //       <span className="truncate max-w-62.5 sm:max-w-100">Used {toolName}</span>
      //     </div>
      //   </div>
      // );
    }
  }

  return null;
}

function WebSearchSummary({ parts }: { parts: any[] }) {
  const [open, setOpen] = useState(false);
  const searches = parts.map((part) => {
    const info = getToolInfo(part);
    const results = Array.isArray(info.output?.results) ? info.output.results : [];
    return { query: info.input?.query as string | undefined, results, running: info.isExecuting };
  });
  const resultCount = searches.reduce((count, search) => count + search.results.length, 0);
  const running = searches.some((search) => search.running);

  return (
    <div className="mb-2 w-full">
      <button
        type="button"
        onClick={() => (resultCount > 0 || searches.length > 1) && setOpen((value) => !value)}
        className="inline-flex items-center gap-2 rounded-md border border-border/50 bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50"
      >
        <Globe className="size-3.5 shrink-0" />
        <span>{running ? 'Searching the web…' : 'Searched the web'}</span>
        {!running && resultCount > 0 ? (
          <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-foreground">
            {resultCount} result{resultCount === 1 ? '' : 's'}
          </span>
        ) : null}
        {!running && (resultCount > 0 || searches.length > 1) ? (
          <ChevronDown className={`size-3 transition-transform ${open ? 'rotate-180' : ''}`} />
        ) : null}
      </button>

      {open ? (
        <div className="mt-2 max-w-xl overflow-hidden rounded-lg border border-border/60 bg-background text-xs">
          {searches
            .flatMap((search) => search.results)
            .slice(0, 5)
            .map((result: any, index) => (
              <a
                key={`${result.url ?? result.title ?? index}-${index}`}
                href={result.url}
                target="_blank"
                rel="noreferrer"
                className="block border-b border-border/50 px-3 py-2.5 last:border-0 hover:bg-muted/40"
              >
                <span className="block truncate font-medium text-foreground">
                  {result.title || result.url}
                </span>
                {result.snippet ? (
                  <span className="mt-0.5 block line-clamp-2 text-muted-foreground">
                    {result.snippet}
                  </span>
                ) : null}
              </a>
            ))}
        </div>
      ) : null}
    </div>
  );
}

function normalizeRepeatedOrderedListMarkers(text: string): string {
  const lines = text.split('\n');
  let previousRepeatedMarker: number | null = null;
  let nextNumber = 2;

  for (let index = 0; index < lines.length; index += 1) {
    const marker = lines[index].match(/^(\s*)1\.\s+(.+)$/);
    if (!marker) {
      if (/^\s*\d+\.\s+/.test(lines[index])) {
        previousRepeatedMarker = null;
        nextNumber = 2;
      }
      continue;
    }

    const onlySupportingListContentSincePrevious =
      previousRepeatedMarker !== null &&
      lines
        .slice(previousRepeatedMarker + 1, index)
        .every((line) => !line.trim() || /^\s*[-*+]\s+/.test(line));

    if (onlySupportingListContentSincePrevious) {
      lines[index] = `${marker[1]}${nextNumber}. ${marker[2]}`;
      nextNumber += 1;
    } else {
      nextNumber = 2;
    }

    previousRepeatedMarker = index;
  }

  return lines.join('\n');
}

export function renderMarkdown(text: string): string {
  if (!text) return '';

  let html = normalizeRepeatedOrderedListMarkers(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  html = html.replace(
    /!\[([^\]]*)\]\([^)]*\)/g,
    (_match, alt) =>
      `<span class="text-muted-foreground italic">[Image unavailable${
        alt ? `: ${alt}` : ''
      }]</span>`,
  );

  // Code blocks — styled premium
  html = html.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    '<pre class="msg-code-block"><code>$2</code></pre>',
  );

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="msg-inline-code">$1</code>');

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong class="msg-bold">$1</strong>');

  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Links and Media (Video/Audio)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, url) => {
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.match(/\.(mp4|webm|ogg)$/) || lowerUrl.includes('video')) {
      return `<video src="${url}" controls preload="metadata" class="max-w-90 w-full rounded-lg my-2 border border-border bg-card"></video>`;
    }
    if (lowerUrl.match(/\.(mp3|wav|m4a|oga)$/) || lowerUrl.includes('audio')) {
      return `<audio src="${url}" controls preload="metadata" class="max-w-80 w-full my-2"></audio>`;
    }
    return `<a href="${url}" target="_blank" rel="noreferrer" class="msg-link">${label}</a>`;
  });

  html = html.replace(/^### (.+)$/gm, '<h3 class="msg-h3">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 class="msg-h2">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 class="msg-h1">$1</h1>');

  // Unordered lists — collect consecutive lines into <ul>
  html = html.replace(/^- (.+)$/gm, '<li class="msg-li">$1</li>');
  // Wrap consecutive <li> in <ul> (including when separated by blank lines)
  html = html.replace(
    /(<li class="msg-li">.*?<\/li>\n?)+/g,
    (match) => `<ul class="msg-ul">${match}</ul>`,
  );

  html = html.replace(/(^\d+\. .+$)(\n\n)((?=\d+\. ))/gm, '$1\n$3');

  html = html.replace(/^(\d+)\. (.+)$/gm, '<li class="msg-li-ordered" data-order="$1">$2</li>');
  html = html.replace(/(<li class="msg-li-ordered" data-order="\d+">.*?<\/li>\n?)+/g, (match) => {
    const start = match.match(/data-order="(\d+)"/)?.[1] ?? '1';
    return `<ol class="msg-ol" start="${start}">${match.replace(/ data-order="\d+"/g, '')}</ol>`;
  });

  // Paragraphs
  html = html.replace(/\n\n/g, '</p><p class="msg-p">');

  html = html.replace(/(<?\/?(?:ul|ol|li|h1|h2|h3|pre)[^>]*>)\n+/g, '$1');
  html = html.replace(/\n+(<\/?(?:ul|ol|li|h1|h2|h3|pre)[^>]*>)/g, '$1');

  html = html.replace(/\n/g, '<br/>');

  return html;
}

// function FollowUpButtons({
//   suggestions,
//   onSelect,
// }: {
//   suggestions: string[];
//   onSelect?: (text: string) => void;
// }) {
//   if (suggestions.length === 0) return null;

//   return (
//     <div className="flex flex-wrap gap-2 pt-1">
//       {suggestions.map((s, i) => (
//         <button
//           key={i}
//           type="button"
//           onClick={() => onSelect?.(s)}
//           className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition ${
//             i === 0
//               ? 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/20'
//               : 'border-border bg-card text-foreground hover:bg-secondary'
//           }`}
//         >
//           {s}
//         </button>
//       ))}
//     </div>
//   );
// }
