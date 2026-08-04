'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { UIMessage } from 'ai';
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
import { KnowledgeBaseResult } from '@/components/chat/tools/knowledge-base-result';
import { useDocEditor } from '@/components/chat/canvas/doc-editor-provider';
import { Reasoning, ReasoningTrigger, ReasoningContent } from '@/components/chat/reasoning';

function FollowUpButtons({
  suggestions,
  onSelect,
}: {
  suggestions: string[];
  onSelect?: (text: string) => void;
}) {
  if (suggestions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 pt-1">
      {suggestions.map((s, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onSelect?.(s)}
          className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition ${
            i === 0
              ? 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/20'
              : 'border-border bg-card text-foreground hover:bg-secondary'
          }`}
        >
          {s}
        </button>
      ))}
    </div>
  );
}

export function MessageItem({
  message,
  isLast,
  isStreaming,
  addToolResult,
  serverId,
}: {
  message: UIMessage;
  isLast?: boolean;
  isStreaming?: boolean;
  addToolResult?: Function;
  serverId?: string | null;
}) {
  const isUser = message.role === 'user';
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
      <div className="message user-message flex justify-end" data-role="user">
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
        </div>
      </div>
    );
  }

  // Assistant message
  const kbParts = parts.filter((p: any) => {
    const { toolName } = getToolInfo(p);
    return toolName === 'searchKnowledgeBase';
  });
  const isKnowledgeSearchActive = kbParts.some((part: any) => getToolInfo(part).isExecuting);

  let signatureFound = false;
  const toolParts = parts.filter((p: any) => {
    const { toolName } = getToolInfo(p);
    if (toolName === 'searchKnowledgeBase') return false;
    if (toolName === 'requestDocumentSignature') {
      if (signatureFound) return false;
      signatureFound = true;
    }
    return true;
  });

  const textParts = parts.filter((p: any) => p.type === 'text');

  const nativeReasoningParts = parts.filter((p: any) => p.type === 'reasoning');
  const nativeReasoningText = nativeReasoningParts
    .map((p: any) => p.text || '')
    .filter(Boolean)
    .join('\n\n');
  const hasNativeReasoning = nativeReasoningParts.length > 0;
  const lastPart = parts.at(-1);
  const isNativeReasoningStreaming = isLast && isStreaming && lastPart?.type === 'reasoning';

  const { allCleanTexts, thinkReasoningText, hasThinkTags } = useMemo(() => {
    let thinkText = '';
    let hasTags = false;
    const cleanTexts: string[] = [];
    for (const part of textParts) {
      const raw = part.text || '';
      const { cleanText, reasoningText } = stripThinkTags(raw);
      cleanTexts.push(cleanText);
      if (reasoningText) {
        thinkText += (thinkText ? '\n\n' : '') + reasoningText;
        hasTags = true;
      }
    }
    return { allCleanTexts: cleanTexts, thinkReasoningText: thinkText, hasThinkTags: hasTags };
  }, [textParts]);

  const isThinkReasoningStreaming = useMemo(() => {
    if (!isLast || !isStreaming || !hasThinkTags) return false;
    const lastText = textParts.at(-1)?.text || '';
    const openCount = (lastText.match(/<think>/gi) || []).length;
    const closeCount = (lastText.match(/<\/think>/gi) || []).length;
    return openCount > closeCount;
  }, [isLast, isStreaming, hasThinkTags, textParts]);

  const combinedReasoningText = [nativeReasoningText, thinkReasoningText]
    .filter(Boolean)
    .join('\n\n');
  const hasAnyReasoning = hasNativeReasoning || hasThinkTags;
  const isReasoningStreaming = isNativeReasoningStreaming || isThinkReasoningStreaming;

  const isShimmering =
    textParts.every((p: any) => !p.text || p.text.trim().length === 0) && isLast && isStreaming;

  const isVizPart = (p: any) => {
    const { toolName, isCompleted } = getToolInfo(p);
    return toolName === 'generateVisualization' && isCompleted;
  };

  const vizParts = toolParts.filter(isVizPart);
  const mediaToolParts = toolParts.filter((p: any) => getToolInfo(p).toolName === 'presentMedia');
  const webSearchParts = toolParts.filter((p: any) => getToolInfo(p).toolName === 'webSearch');
  const nonVizToolParts = toolParts.filter(
    (p: any) =>
      !isVizPart(p) &&
      getToolInfo(p).toolName !== 'presentMedia' &&
      getToolInfo(p).toolName !== 'webSearch',
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
        return isExecuting && toolName !== 'searchKnowledgeBase';
      }),
    [toolParts],
  );

  return (
    <div className="message assistant-message flex flex-col gap-2" data-role="assistant">
      {kbParts.length > 0 && <KnowledgeBaseResult parts={kbParts} isShimmering={isShimmering} />}

      {webSearchParts.length > 0 && <WebSearchSummary parts={webSearchParts} />}

      {hasAnyReasoning && !isKnowledgeSearchActive && (
        <Reasoning isStreaming={isReasoningStreaming}>
          <ReasoningTrigger />
          <ReasoningContent>{combinedReasoningText}</ReasoningContent>
        </Reasoning>
      )}

      {nonVizToolParts
        .filter((p: any) => getToolInfo(p).isCompleted)
        .map((part: any, i: number) =>
          renderToolPart(part, i, addToolResult, updateFromToolResult),
        )}

      {vizTabs ? (
        <ChatTabs config={{ tabs: vizTabs }} />
      ) : (
        vizParts.map((part: any, i: number) =>
          renderToolPart(part, i, addToolResult, updateFromToolResult),
        )
      )}

      {executingParts.map((part: any, i: number) =>
        renderToolPart(part, i, addToolResult, updateFromToolResult),
      )}

      {isLast &&
        isStreaming &&
        executingParts.length === 0 &&
        !isKnowledgeSearchActive &&
        !hasAnyReasoning &&
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
  let cleaned = text;

  // Extract complete <think>…</think> blocks
  const completeRegex = /<think>([\s\S]*?)<\/think>/gi;
  let match;
  while ((match = completeRegex.exec(cleaned)) !== null) {
    reasoningParts.push(match[1].trim());
  }
  cleaned = cleaned.replace(completeRegex, '');

  // Extract unclosed <think>… (streaming, no closing tag yet)
  const unclosedRegex = /<think>([\s\S]*)$/i;
  const unclosedMatch = cleaned.match(unclosedRegex);
  if (unclosedMatch) {
    reasoningParts.push(unclosedMatch[1].trim());
    cleaned = cleaned.replace(unclosedRegex, '');
  }

  return {
    cleanText: cleaned.trim(),
    reasoningText: reasoningParts.filter(Boolean).join('\n\n'),
  };
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
      output: ti.result,
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
      output: part.output,
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
): React.ReactNode | null {
  const { toolName, isExecuting, isCompleted, output, input } = getToolInfo(part);

  // Still executing — show loading indicator
  if (isExecuting) {
    if (toolName === 'searchKnowledgeBase') return null;

    if (toolName === 'requestDocumentSignature') {
      const callId = part.toolInvocation?.toolCallId || part.toolCallId || part.id || '';
      return (
        <ChatSignatureRequest
          key={index}
          detectedLocations={input?.detectedLocations}
          toolCallId={callId}
          addToolResult={addToolResult}
        />
      );
    }

    return (
      <div key={index} className="flex items-center gap-2 py-3">
        <div className="size-6.5 bg-white dark:bg-card border border-border rounded-full flex items-center justify-center p-1 animate-pulse">
          <img src="/logo.png" alt="logo" className="size-4 animate-spin" />
        </div>
        <span className="text-[13px] font-medium text-foreground/80 animate-pulse">
          {toolName === 'queryTabularData' && 'Querying data...'}
          {toolName === 'generateVisualization' && 'Generating chart...'}
          {toolName === 'executeAnalysis' && 'Running analysis...'}
          {toolName === 'getIndexedData' && 'Fetching corpus data...'}
          {toolName === 'analyzeCorpusWithCode' && 'Analyzing corpus...'}
          {toolName === 'fillDocumentForm' && 'Filling form fields...'}
          {toolName === 'editDocument' && 'Editing document...'}
          {toolName === 'requestDocumentSignature' && 'Processing signature request...'}
          {![
            'queryTabularData',
            'generateVisualization',
            'executeAnalysis',
            'getIndexedData',
            'analyzeCorpusWithCode',
            'fillDocumentForm',
            'editDocument',
            'requestDocumentSignature',
          ].includes(toolName) && 'Processing...'}
        </span>
      </div>
    );
  }

  if (isCompleted) {
    switch (toolName) {
      case 'queryTabularData': {
        if (output.error) return null;
        const tableConfig: DataTableConfig = {
          columns: output.columns ?? [],
          rows: output.rows ?? [],
          totalRows: output.totalRows ?? 0,
          aggregationResults: output.aggregationResults,
        };
        if (tableConfig.rows.length === 0 && !tableConfig.aggregationResults) return null;
        return <ChatDataTable key={index} config={tableConfig} />;
      }

      case 'generateVisualization': {
        const chartConfig = output as ChartConfig;
        if (!chartConfig?.data || chartConfig.data.length === 0) return null;
        return <ChatChart key={index} config={chartConfig} />;
      }

      case 'executeAnalysis':
      case 'analyzeCorpusWithCode': {
        const result = output as SandboxResultConfig;
        const code = input?.code;
        return <ChatSandboxResult key={index} config={result} code={code} />;
      }

      case 'getIndexedData': {
        const corpusConfig = output as CorpusDataConfig;
        if (!corpusConfig) return null;
        return <CorpusDataResult key={index} config={corpusConfig} />;
      }

      case 'fillDocumentForm':
      case 'editDocument': {
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

      case 'requestDocumentSignature': {
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

      case 'webSearch': {
        if (output.error) return null;
        const resultsCount = output.results?.length || 0;
        return (
          <div key={index} className="mb-2 w-full">
            <div className="inline-flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground bg-muted/30 rounded-md border border-border/50">
              <Globe className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate max-w-62.5 sm:max-w-100">
                Searched web for "{input?.query}"
              </span>
              <span className="shrink-0 text-[10px] bg-secondary text-foreground px-1.5 py-0.5 rounded-full font-medium ml-1">
                {resultsCount} result{resultsCount === 1 ? '' : 's'}
              </span>
            </div>
          </div>
        );
      }

      case 'analyzeImageDeeply': {
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

      case 'presentMedia': {
        if (
          !output?.success ||
          !output.assetId ||
          !['image', 'video', 'audio'].includes(output.mediaType)
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
        return (
          <div key={index} className="mb-2 w-full">
            <div className="inline-flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground bg-muted/30 rounded-md border border-border/50">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate max-w-62.5 sm:max-w-100">Used {toolName}</span>
            </div>
          </div>
        );
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

function renderMarkdown(text: string): string {
  if (!text) return '';

  let html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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

  // Ordered lists — normalize paragraph-separated numbered lists first.
  // Small LLMs often output `1. item\n\n1. item\n\n1. item` instead of
  // consecutive lines. Collapse the double-newlines between numbered items
  // so they group into a single <ol>.
  html = html.replace(/(^\d+\. .+$)(\n\n)((?=\d+\. ))/gm, '$1\n$3');

  html = html.replace(/^\d+\. (.+)$/gm, '<li class="msg-li-ordered">$1</li>');
  html = html.replace(
    /(<li class="msg-li-ordered">.*?<\/li>\n?)+/g,
    (match) => `<ol class="msg-ol">${match}</ol>`,
  );

  // Paragraphs
  html = html.replace(/\n\n/g, '</p><p class="msg-p">');

  html = html.replace(/(<?\/?(?:ul|ol|li|h1|h2|h3|pre)[^>]*>)\n+/g, '$1');
  html = html.replace(/\n+(<\/?(?:ul|ol|li|h1|h2|h3|pre)[^>]*>)/g, '$1');

  html = html.replace(/\n/g, '<br/>');

  return html;
}
