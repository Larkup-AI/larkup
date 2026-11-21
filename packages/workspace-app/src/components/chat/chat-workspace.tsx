'use client';

import { workspaceUrl, workspaceFetch as fetch } from '../../host';
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { compactConversationMessages } from '@larkup/core/conversation-history';
import { compactToolResult } from '../../lib/chat/message-compaction';
import type { RagConfig } from '@larkup/core/types';
import {
  ArrowUp,
  SquarePen,
  RotateCcw,
  TriangleAlert,
  Loader2,
  ChevronDown,
  MessageCircle,
  Search,
  X,
  History,
  Trash2,
  Plus,
  Globe,
  Paperclip,
  ListPlus,
} from 'lucide-react';
import useSWR, { mutate as globalMutate } from 'swr';
import { MessageItem } from './message-item';
import { ThinkingIndicator } from './thinking-indicator';
import { GENERIC_THINKING_STEPS, GENERIC_THINKING_ICON } from '../../lib/constants/tools';
import { MessageQueue, type QueuedMessage } from './message-queue';
import { JobsTrackingButton } from '../data/jobs-tracking-button';
import { shouldAutoOpenSupportingClip } from '../../lib/chat-supporting-clip';
import { useProject } from '../projects/project-provider';
import { cn } from '../../lib/utils';
import { getProviderMeta, ProviderIcon } from '@larkup/workspace-ui/provider-icon';
import { get, set, del, keys } from '../../storage';
import { useRouter } from 'next/navigation';
import { useChatStore } from '../../store/chat-store';
import { toast } from 'sonner';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '../ui/sheet';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../ui/alert-dialog';
import { DocEditorProvider, useDocEditor } from './canvas/doc-editor-provider';
import { DocumentCanvas } from './canvas/document-canvas';
import { FileAttachmentButton } from './canvas/file-attachment-button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Switch } from '../ui/switch';
import { ChatMessagesViewport } from '@larkup/workspace-ui';
import {
  answerFeedbackForMessage,
  groundedAnswerFeedbackContext,
  updateAnswerFeedback,
  type AnswerFeedback,
} from '../../lib/chat/message-feedback';

const fetcher = async <T,>(url: string): Promise<T> => {
  const response = await fetch(url);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload &&
      typeof payload === 'object' &&
      'error' in payload &&
      typeof payload.error === 'string'
        ? payload.error
        : 'Could not load chat configuration.';
    throw new Error(message);
  }
  return payload as T;
};

/**
 * Compact messages for the LLM context to prevent massive payloads (like chart data,
 * table rows, and document base64s) from bloating the request and exceeding token limits.
 */
function compactMessagesForLLM(messages: any[]) {
  return messages.map((message, index) => {
    // Keep the latest message completely intact
    if (index === messages.length - 1) return message;

    const { toolInvocations, experimental_attachments, parts, ...rest } = message;

    // Keep tool invocations but strip heavy data fields from the results
    const compactToolInvocations = Array.isArray(toolInvocations)
      ? toolInvocations.map((ti) => {
          if (ti.state === 'result' && ti.result) {
            return { ...ti, result: compactToolResult(ti.result) };
          }
          return ti;
        })
      : toolInvocations;

    // Do the same for parts
    const compactParts = Array.isArray(parts)
      ? parts.map((part) => {
          if (part.type === 'tool-invocation') {
            const ti = part.toolInvocation;
            if (ti?.state === 'result' && ti.result) {
              return { ...part, toolInvocation: { ...ti, result: compactToolResult(ti.result) } };
            }
          }
          // AI SDK v5 serializes completed tool calls as `tool-<name>` parts.
          // Keep the metadata needed by the server-side evidence ledger while
          // bounding rows/chart points before the next chat request.
          if (part.type?.startsWith('tool-')) {
            return {
              ...part,
              ...(part.output !== undefined ? { output: compactToolResult(part.output) } : {}),
              ...(part.result !== undefined ? { result: compactToolResult(part.result) } : {}),
            };
          }
          return part;
        })
      : parts;

    // Strip attachment payloads to just labels to save context window
    const attachmentLabels = Array.isArray(experimental_attachments)
      ? experimental_attachments.map((attachment) => ({
          name: attachment?.name,
          contentType: attachment?.contentType,
          size: attachment?.size,
        }))
      : experimental_attachments;

    return {
      ...rest,
      ...(compactParts ? { parts: compactParts } : {}),
      ...(compactToolInvocations ? { toolInvocations: compactToolInvocations } : {}),
      ...(attachmentLabels ? { experimental_attachments: attachmentLabels } : {}),
    };
  });
}

interface AvailableModel {
  id: string;
  label: string;
  provider: string;
  context_window?: number;
  tags?: string[];
}

function getFileIconPath(file: File) {
  const extension = file.name.split('.').pop()?.toLowerCase();
  const mimeType = file.type;

  if (['csv', 'xls', 'xlsx'].includes(extension || '')) return '/icons/excel.png';
  if (['doc', 'docx'].includes(extension || '')) return '/icons/word.png';
  if (['md', 'markdown'].includes(extension || '')) return '/icons/markdown.png';
  if (['pdf'].includes(extension || '')) return '/icons/pdf.png';

  if (mimeType.startsWith('video/')) return '/icons/video.png';
  if (mimeType.startsWith('audio/')) return '/icons/audio.png';
  if (mimeType.startsWith('image/')) return '/icons/image.png';

  return '/icons/image.png'; // Fallback
}

function AttachmentCard({
  file,
  onClick,
  onRemove,
}: {
  file: File;
  onClick?: () => void;
  onRemove: () => void;
}) {
  const iconPath = getFileIconPath(file);

  return (
    <div
      className="relative mt-2 group flex items-center gap-2 bg-muted/50 border border-border/60 rounded-xl h-12 px-3 p-1 shrink-0 cursor-pointer hover:bg-muted/80 transition-colors"
      onClick={onClick}
    >
      <div className="size-7 shrink-0 rounded-md overflow-hidden bg-background border border-border/90 flex items-center justify-center p-1">
        <img src={iconPath} alt={file.name} className="w-full h-full object-contain" />
      </div>
      <div className="flex flex-col justify-center max-w-30">
        <span className="text-xs font-medium truncate text-foreground">{file.name}</span>
        <span className="text-[10px] text-muted-foreground">
          {(file.size / 1024).toFixed(0)} KB
        </span>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onRemove();
        }}
        className="absolute cursor-pointer -top-3 -right-2 flex h-5 w-5 items-center justify-center rounded-full bg-background border border-border text-muted-foreground hover:bg-destructive hover:border-destructive hover:text-white transition  opacity-0 group-hover:opacity-100"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

function getTimeOfDayGreeting() {
  const hour = new Date().getHours();
  const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return `${part}. How can I help you?`;
}

// Suggestions cycle only while the empty-chat composer has no typed message.
const CHAT_SUGGESTIONS = [
  'Ask Larkup',
  'Describe what happens in this video',
  'Summarize this chart for me',
  'Search my knowledge base for a topic',
  'Pull the key data out of this PDF',
  'Turn this data into a chart',
  'Export this table as a file',
];

function AnimatedPlaceholder({ items }: { items: readonly string[] }) {
  const [index, setIndex] = useState(0);
  const [isSliding, setIsSliding] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = () => {
      setReduceMotion(media.matches);
      if (media.matches) setIsSliding(false);
    };

    updatePreference();
    media.addEventListener('change', updatePreference);
    return () => media.removeEventListener('change', updatePreference);
  }, []);

  // Keep each suggestion readable before moving the entire two-line track up.
  useEffect(() => {
    if (reduceMotion || items.length < 2) return;
    const timer = window.setTimeout(() => setIsSliding(true), 3200);
    return () => window.clearTimeout(timer);
  }, [index, items.length, reduceMotion]);

  useEffect(() => {
    if (!isSliding) return;
    const timer = window.setTimeout(() => {
      // Reset without a reverse animation. The previous second line now
      // occupies the first slot at exactly the same screen position.
      setIndex((current) => (current + 1) % items.length);
      setIsSliding(false);
    }, 460);
    return () => window.clearTimeout(timer);
  }, [isSliding, items.length]);

  if (items.length === 0) return null;

  return (
    <div className="h-6 overflow-hidden" aria-hidden="true">
      <div
        className={cn(
          'flex flex-col',
          isSliding
            ? '-translate-y-6 transition-transform duration-[460ms] ease-[cubic-bezier(0.22,1,0.36,1)]'
            : 'translate-y-0',
        )}
      >
        <span className="block h-6 shrink-0 truncate text-[15px] leading-6 text-[#929292] dark:text-[#a6a6a6]">
          {items[index]}
        </span>
        <span className="block h-6 shrink-0 truncate text-[15px] leading-6 text-[#929292] dark:text-[#a6a6a6]">
          {items[(index + 1) % items.length]}
        </span>
      </div>
    </div>
  );
}

interface ChatStatus {
  ready: boolean;
  indexed: boolean;
  blockers: string[];
  provider: string;
  chatModelId: string;
  availableModels: AvailableModel[];
}

export function ChatWorkspace({ chatId }: { chatId?: string } = {}) {
  return (
    <DocEditorProvider>
      <DocumentCanvas>
        <ChatWorkspaceInner chatId={chatId} />
      </DocumentCanvas>
    </DocEditorProvider>
  );
}

function ChatWorkspaceInner({ chatId }: { chatId?: string }) {
  const { activeProject } = useProject();
  const { sessionId, parsedDocument, openCanvas, isLoading: isDocLoading } = useDocEditor();
  const docEditorState = { sessionId, fields: parsedDocument?.fields || [] };
  const projectId = activeProject?.id ?? null;

  // Track dragging state
  const dragCounter = useRef(0);
  const [isDragging, setIsDragging] = useState(false);

  const statusKey = projectId
    ? workspaceUrl(`/api/chat/status?projectId=${encodeURIComponent(projectId)}`)
    : workspaceUrl('/api/chat/status');
  const {
    data: status,
    error: statusError,
    isLoading: statusLoading,
  } = useSWR<ChatStatus>(statusKey, fetcher, {
    refreshInterval: 10000,
  });

  const { data: configData, mutate: mutateConfig } = useSWR<{ config: RagConfig }>(
    workspaceUrl('/api/config'),
    fetcher,
  );
  const router = useRouter();

  const { selectedModel, setSelectedModel } = useChatStore();
  const [showModelSelect, setShowModelSelect] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [pendingMessage, setPendingMessage] = useState<{ text: string; files?: any } | null>(null);
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>([]);
  const [greeting, setGreeting] = useState('How can I help you?');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setGreeting(getTimeOfDayGreeting());
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    // Grow the composer up to 176px, then scroll longer drafts.
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 176)}px`;
    el.style.overflowY = el.scrollHeight > 176 ? 'auto' : 'hidden';
  }, [input]);

  const [currentChatId, setCurrentChatId] = useState<string>(chatId || '');
  const [history, setHistory] = useState<{ id: string; title: string; updatedAt: number }[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const [isInitializingChat, setIsInitializingChat] = useState(!!chatId);

  // Load history on mount
  useEffect(() => {
    get('chat_sessions').then((val) => {
      if (val) setHistory(val);
    });
  }, []);

  // Update selected model when status loads
  useEffect(() => {
    if (!status?.chatModelId) return;
    const available = status.availableModels?.some((model) => model.id === selectedModel);
    if (!selectedModel || !available) setSelectedModel(status.chatModelId);
  }, [status?.chatModelId, status?.availableModels, selectedModel, setSelectedModel]);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (showModelSelect) {
      // Small delay to let the DOM render
      requestAnimationFrame(() => searchInputRef.current?.focus());
    } else {
      setModelSearch('');
    }
  }, [showModelSelect]);

  const chatBody = useMemo(
    () => ({
      projectId,
      chatModelId: selectedModel || undefined,
      docSessionId: docEditorState.sessionId,
      docFields: docEditorState.fields,
    }),
    [projectId, selectedModel, docEditorState.sessionId, JSON.stringify(docEditorState.fields)],
  );

  const chatBodyRef = useRef(chatBody);
  useEffect(() => {
    chatBodyRef.current = chatBody;
  }, [chatBody]);

  const conversationContextCache = useRef<{ source: any[]; compact: any[] } | null>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: workspaceUrl('/api/chat'),
        fetch,
        headers: {
          'Content-Type': 'application/json',
        },
        prepareSendMessagesRequest({ messages, id, body }) {
          return {
            body: {
              messages: compactMessagesForLLM(
                (() => {
                  const cache = conversationContextCache.current;
                  const prefixMatches =
                    cache &&
                    cache.source.length === messages.length - 1 &&
                    cache.source.every((message, index) => message === messages[index]);
                  return prefixMatches
                    ? [...cache.compact, messages[messages.length - 1]]
                    : compactConversationMessages(messages, 160);
                })(),
              ),
              id,
              ...chatBodyRef.current,
              ...body,
            },
          };
        },
      }),
    [],
  );

  const {
    messages,
    sendMessage,
    status: chatStatus,
    setMessages,
    error,
    regenerate,
    addToolResult,
  } = useChat({
    transport,
  });

  useEffect(() => {
    if (chatStatus !== 'ready') return;
    const compact = () => {
      conversationContextCache.current = {
        source: messages,
        compact: compactConversationMessages(messages, 160),
      };
    };
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(compact, { timeout: 1_000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(compact, 0);
    return () => window.clearTimeout(id);
  }, [messages, chatStatus]);

  // Initialize specific chat if ID is provided via prop
  useEffect(() => {
    setQueuedMessages([]);
    if (chatId) {
      setIsInitializingChat(true);
      get(`chat_messages_${chatId}`).then((msgs) => {
        if (msgs) {
          setMessages(msgs);
          setCurrentChatId(chatId);
        }
        setIsInitializingChat(false);
      });
    } else {
      setIsInitializingChat(false);
    }
  }, [chatId, setMessages]);

  useEffect(() => {
    if (pendingMessage && docEditorState.sessionId && !isDocLoading) {
      sendMessage(pendingMessage);
      setPendingMessage(null);
    }
  }, [pendingMessage, docEditorState.sessionId, isDocLoading, sendMessage]);

  // Auto-open PDF if the AI uses a document tool and the canvas is not open
  useEffect(() => {
    if (!docEditorState.sessionId && openCanvas && messages.length > 0 && !isDocLoading) {
      const lastMsg = messages[messages.length - 1] as any;
      if (lastMsg.role === 'assistant' && lastMsg.toolInvocations) {
        const hasDocTool = lastMsg.toolInvocations.some((t: any) =>
          ['requestDocumentSignature', 'fillDocumentForm', 'editDocument'].includes(t.toolName),
        );
        if (hasDocTool) {
          // Find the last PDF attachment in the chat
          let targetAtt: any = null;
          for (let i = messages.length - 1; i >= 0; i--) {
            const m = messages[i] as any;
            if (m.experimental_attachments) {
              const pdfs = m.experimental_attachments.filter(
                (a: any) =>
                  a.contentType?.includes('pdf') || a.name?.toLowerCase().endsWith('.pdf'),
              );
              if (pdfs.length > 0) {
                targetAtt = pdfs[pdfs.length - 1];
                break;
              }
            }
          }

          if (targetAtt && targetAtt.url) {
            let fetchUrl = targetAtt.url;
            if (!fetchUrl.startsWith('http') && !fetchUrl.startsWith('data:')) {
              fetchUrl = `data:${targetAtt.contentType || 'application/pdf'};base64,${fetchUrl}`;
            }
            fetch(fetchUrl)
              .then((r) => r.blob())
              .then((blob) => {
                const file = new File([blob], targetAtt.name || 'document.pdf', {
                  type: targetAtt.contentType || 'application/pdf',
                });
                openCanvas(file, { background: false });
              })
              .catch((err) => console.error('Auto-open failed', err));
          }
        }
      }
    }
  }, [messages, docEditorState.sessionId, openCanvas, isDocLoading]);

  // Reset chat context when switching workspaces to prevent overlap
  useEffect(() => {
    setMessages([]);
    setCurrentChatId('');
    setQueuedMessages([]);
  }, [projectId, setMessages]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const isBusy = chatStatus === 'submitted' || chatStatus === 'streaming';

  // Drain the queue one message at a time once the assistant is free again
  useEffect(() => {
    if (queuedMessages.length === 0 || isBusy || isDocLoading || pendingMessage) return;
    const [next, ...rest] = queuedMessages;
    setQueuedMessages(rest);
    shouldAutoScrollRef.current = true;
    const dt = new DataTransfer();
    (next.files ?? []).forEach((file) => dt.items.add(file));
    sendMessage({ text: next.text, files: dt.files.length > 0 ? dt.files : undefined });
  }, [queuedMessages, isBusy, isDocLoading, pendingMessage, sendMessage]);

  const handleMessageScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    shouldAutoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !shouldAutoScrollRef.current) return;
    const id = requestAnimationFrame(() => {
      el.scrollTo({
        top: el.scrollHeight,
        behavior: chatStatus === 'streaming' ? 'auto' : 'smooth',
      });
    });
    return () => cancelAnimationFrame(id);
  }, [messages, chatStatus]);
  // Save messages to history — debounced to prevent cascading re-renders during streaming
  const historySaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const feedbackSyncRevision = useRef<Record<string, number>>({});

  const handleMessageFeedback = useCallback(
    (messageId: string, feedback: AnswerFeedback | undefined) => {
      const currentMessages = messagesRef.current;
      const currentMessage = currentMessages.find((message) => message.id === messageId);
      const previousFeedback = currentMessage
        ? answerFeedbackForMessage(currentMessage)
        : undefined;
      const cacheContext = groundedAnswerFeedbackContext(currentMessages, messageId);
      const nextMessages = updateAnswerFeedback(currentMessages, messageId, feedback);
      messagesRef.current = nextMessages;
      setMessages(nextMessages);

      // Persist immediately instead of waiting for the normal history debounce;
      // a reload directly after clicking a thumb must not lose the selection.
      const activeId = currentChatId || crypto.randomUUID();
      if (!currentChatId) {
        setCurrentChatId(activeId);
        if (window.location.pathname === '/chat') {
          window.history.replaceState(null, '', `/chat/${activeId}`);
        }
      }
      void set(`chat_messages_${activeId}`, nextMessages).catch((storageError) => {
        console.error('Failed to save answer feedback', storageError);
        toast.error('Could not save this feedback. Please try again.');
      });

      // Only plain-document grounded answers enter the reusable answer cache.
      // Media, exports, and multi-tool results keep their specialized paths.
      if (!cacheContext) {
        if (feedback === 'liked') {
          toast.success(
            'Feedback saved. This answer type will use fresh tool results when repeated.',
          );
        }
        return;
      }
      const revision = (feedbackSyncRevision.current[messageId] ?? 0) + 1;
      feedbackSyncRevision.current[messageId] = revision;
      void fetch(workspaceUrl('/api/chat/feedback'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
          projectId,
          feedback,
          ...cacheContext,
        }),
      })
        .then(async (response) => {
          const result = (await response.json().catch(() => null)) as {
            cached?: boolean;
            removed?: boolean;
            error?: string;
          } | null;
          if (!response.ok) {
            throw new Error(result?.error || 'Could not update the answer cache.');
          }
          if (feedback === 'liked' && result?.cached) {
            toast.success('Answer saved to Larkup cache');
          } else if (feedback === 'disliked' && result?.removed) {
            toast.success('Cached answer removed');
          }
          void globalMutate(workspaceUrl('/api/system/cache'));
        })
        .catch((feedbackError) => {
          if (feedbackSyncRevision.current[messageId] !== revision) return;
          const rolledBack = updateAnswerFeedback(messagesRef.current, messageId, previousFeedback);
          messagesRef.current = rolledBack;
          setMessages(rolledBack);
          void set(`chat_messages_${activeId}`, rolledBack);
          toast.error(
            feedbackError instanceof Error
              ? feedbackError.message
              : 'Could not update the answer cache.',
          );
        });
    },
    [currentChatId, projectId, setMessages],
  );

  useEffect(() => {
    if (messages.length === 0) return;
    // Don't save while actively streaming — wait for it to settle
    if (chatStatus === 'streaming' || chatStatus === 'submitted') return;

    // Debounce: clear previous timer
    if (historySaveTimer.current) clearTimeout(historySaveTimer.current);

    historySaveTimer.current = setTimeout(() => {
      const currentMessages = messagesRef.current;
      if (currentMessages.length === 0) return;

      let activeId = currentChatId;
      if (!activeId) {
        activeId = crypto.randomUUID();
        setCurrentChatId(activeId);
      }

      // Save full messages to IDB so UI (charts, tables) can be restored on reload
      set(`chat_messages_${activeId}`, currentMessages);

      if (window.location.pathname === '/chat') {
        window.history.replaceState(null, '', `/chat/${activeId}`);
      }

      setHistory((prev) => {
        const existing = prev.find((p) => p.id === activeId);
        const firstMsg = currentMessages[0];
        const firstMsgText =
          (firstMsg as any)?.parts
            ?.filter((p: any) => p.type === 'text')
            ?.map((p: any) => p.text)
            ?.join('') ||
          (firstMsg as any)?.content ||
          (firstMsg as any)?.text;

        const title = firstMsgText ? firstMsgText.substring(0, 40) : 'New Chat';

        // Prevent update if nothing changed
        if (existing && existing.title === title) {
          return prev;
        }

        let next;
        if (existing) {
          next = prev.map((p) => (p.id === activeId ? { ...p, title, updatedAt: Date.now() } : p));
        } else {
          next = [{ id: activeId, title, updatedAt: Date.now() }, ...prev];
        }

        set('chat_sessions', next);
        return next;
      });
    }, 500);

    return () => {
      if (historySaveTimer.current) clearTimeout(historySaveTimer.current);
    };
  }, [messages, currentChatId, chatStatus]);

  // Group and filter models
  const groupedModels = useMemo(() => {
    const models = status?.availableModels ?? [];
    const query = modelSearch.toLowerCase().trim();
    const filtered = query
      ? models.filter(
          (m) =>
            m.label.toLowerCase().includes(query) ||
            m.id.toLowerCase().includes(query) ||
            m.provider.toLowerCase().includes(query),
        )
      : models;

    const groups = new Map<string, AvailableModel[]>();
    for (const m of filtered) {
      const existing = groups.get(m.provider) ?? [];
      existing.push(m);
      groups.set(m.provider, existing);
    }
    return groups;
  }, [status?.availableModels, modelSearch]);

  const filteredHistory = useMemo(() => {
    const sorted = [...history].sort((a, b) => b.updatedAt - a.updatedAt);
    const query = historySearch.toLowerCase().trim();
    return query ? sorted.filter((chat) => chat.title.toLowerCase().includes(query)) : sorted;
  }, [history, historySearch]);

  function removeFromQueue(id: string) {
    setQueuedMessages((prev) => prev.filter((m) => m.id !== id));
  }

  function moveQueueItem(id: string, direction: -1 | 1) {
    setQueuedMessages((prev) => {
      const index = prev.findIndex((m) => m.id === id);
      const target = index + direction;
      if (index === -1 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function editQueueItem(id: string) {
    const item = queuedMessages.find((m) => m.id === id);
    if (!item) return;
    setQueuedMessages((prev) => prev.filter((m) => m.id !== id));
    setInput(item.text);
    setAttachments(item.files ?? []);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function handleSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const text = input.trim();
    if (!text && attachments.length === 0) return;

    if (isBusy || isDocLoading) {
      setQueuedMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), text, files: attachments.length > 0 ? attachments : undefined },
      ]);
      setInput('');
      setAttachments([]);
      return;
    }

    shouldAutoScrollRef.current = true;

    const dt = new DataTransfer();
    attachments.forEach((file) => dt.items.add(file));
    const files = dt.files.length > 0 ? dt.files : undefined;

    if (files) {
      const docFile = Array.from(files).find(
        (f) =>
          f.type === 'application/pdf' ||
          f.name.toLowerCase().endsWith('.pdf') ||
          f.name.toLowerCase().endsWith('.doc') ||
          f.name.toLowerCase().endsWith('.docx'),
      );

      // If we have a document that needs opening, open it BEFORE sending the message!
      if (docFile && !docEditorState.sessionId) {
        toast.info('Preparing document...');
        setPendingMessage({ text, files });
        openCanvas(docFile, { background: false }).catch((err) => {
          toast.error(err.message || 'Failed to open document');
          setPendingMessage(null);
          // Send the message anyway so the user's text isn't lost
          sendMessage({ text, files });
        });
        setInput('');
        setAttachments([]);
        return;
      }

      sendMessage({ text, files });
    } else {
      let docToOpen: any = null;
      if (!docEditorState.sessionId) {
        for (let i = messages.length - 1; i >= 0; i--) {
          const m = messages[i] as any;
          if (m.experimental_attachments) {
            const docs = m.experimental_attachments.filter(
              (a: any) =>
                a.contentType?.includes('pdf') ||
                a.name?.toLowerCase().endsWith('.pdf') ||
                a.name?.toLowerCase().endsWith('.doc') ||
                a.name?.toLowerCase().endsWith('.docx'),
            );
            if (docs.length > 0) {
              docToOpen = docs[docs.length - 1];
              break;
            }
          }
        }
      }

      if (docToOpen) {
        toast.info('Preparing document...');
        let fetchUrl = docToOpen.url;
        if (!fetchUrl.startsWith('http') && !fetchUrl.startsWith('data:')) {
          fetchUrl = `data:${docToOpen.contentType || 'application/pdf'};base64,${fetchUrl}`;
        }

        setPendingMessage({ text });
        fetch(fetchUrl)
          .then((r) => r.blob())
          .then((blob) => {
            const file = new File([blob], docToOpen.name || 'document.pdf', {
              type: docToOpen.contentType || 'application/pdf',
            });
            openCanvas(file, { background: false }).catch((err) => {
              toast.error(err.message || 'Failed to open document');
              setPendingMessage(null);
              sendMessage({ text });
            });
          })
          .catch((err) => {
            console.error('Auto-open failed', err);
            setPendingMessage(null);
            sendMessage({ text });
          });

        setInput('');
        setAttachments([]);
        return;
      }

      sendMessage({ text });
    }

    setInput('');
    setAttachments([]);
  }

  function newChat() {
    setMessages([]);
    setInput('');
    setQueuedMessages([]);
    setCurrentChatId(crypto.randomUUID());
    window.history.pushState(null, '', '/chat');
  }

  useEffect(() => {
    const handleNewChat = () => newChat();
    window.addEventListener('new-chat', handleNewChat);
    return () => window.removeEventListener('new-chat', handleNewChat);
  }, []);

  async function handleWebSearchToggle() {
    const config = configData?.config;
    if (!config) return;

    const provider = config.webSearchProvider || 'tavily';
    const apiKeys: Record<string, string | undefined> = {
      tavily: config.tavilyApiKey,
      serper: config.serperApiKey,
      google: config.serperApiKey,
      brave: config.braveApiKey,
      bing: config.bingApiKey,
      exa: config.exaApiKey,
    };

    if (provider !== 'local' && !apiKeys[provider]) {
      toast.error('Web Search API key is missing. Please configure it in Settings.');
      router.push('/settings?section=search-web');
      return;
    }

    const nextState = !config.webSearchEnabled;
    try {
      await fetch(workspaceUrl('/api/config'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...config, webSearchEnabled: nextState }),
      });
      await mutateConfig();
      toast.success(`Web Search ${nextState ? 'enabled' : 'disabled'}`);
    } catch (e: any) {
      toast.error(e.message || 'Failed to update web search setting');
    }
  }

  async function loadChat(id: string) {
    const msgs = await get(`chat_messages_${id}`);
    if (msgs) {
      setMessages(msgs);
      setCurrentChatId(id);
      setIsHistoryOpen(false);
      window.history.pushState(null, '', `/chat/${id}`);
    }
  }

  async function deleteChat(id: string) {
    await del(`chat_messages_${id}`);
    setHistory((prev) => {
      const next = prev.filter((p) => p.id !== id);
      set('chat_sessions', next);
      return next;
    });
    if (currentChatId === id) {
      setMessages([]);
      setInput('');
      setCurrentChatId('');
      window.history.pushState(null, '', '/chat');
    }
  }

  async function deleteAllChats() {
    try {
      const chatStorageKeys = (await keys()).filter(
        (key): key is string =>
          typeof key === 'string' && (key === 'chat_sessions' || key.startsWith('chat_messages_')),
      );
      await Promise.all(chatStorageKeys.map((key) => del(key)));
      setHistory([]);
      setHistorySearch('');
      setMessages([]);
      setQueuedMessages([]);
      setCurrentChatId('');
      window.history.pushState(null, '', '/chat');
      toast.success('Chat history cleared');
    } catch (error) {
      console.error('Failed to clear chat history', error);
      toast.error('Could not clear chat history. Please try again.');
    }
  }

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      if (Array.from(e.dataTransfer.items).some((item) => item.kind === 'file')) {
        setIsDragging(true);
      }
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      dragCounter.current = 0;

      const fileList = e.dataTransfer.files;
      if (!fileList || fileList.length === 0) return;

      const newAttachments = Array.from(fileList);

      if (newAttachments.length === 0) {
        toast.error('No valid files dropped.');
        return;
      }

      setAttachments((prev) => [...prev, ...newAttachments]);

      // Auto-open PDF if dropped
      const pdfFile = newAttachments.find(
        (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
      );
      if (pdfFile) {
        openCanvas(pdfFile, { background: false }).catch((err) => {
          toast.error(err.message || 'Failed to auto-open document');
        });
      }
    },
    [openCanvas],
  );

  const isEmpty = messages.length === 0 && !isInitializingChat;
  const ready = status?.ready ?? false;
  const selectedModelData = status?.availableModels?.find((m) => m.id === selectedModel);

  const composerForm = (
    <form onSubmit={handleSubmit} className="mx-auto w-full max-w-3xl">
      {/* ChatGPT-like neutral surface: no colored focus ring, only a quiet gray border. */}
      <div className="relative rounded-[24px] border border-[#e8e8e8] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.025)] transition-[border-color,box-shadow] duration-150 focus-within:border-[#d6d6d6] focus-within:shadow-[0_1px_4px_rgba(0,0,0,0.045)] dark:border-[#393939] dark:bg-[#262626] dark:shadow-none dark:focus-within:border-[#555555] dark:focus-within:shadow-none">
        {attachments.length > 0 && (
          <div className="flex w-full items-center gap-2 overflow-x-auto px-4 pt-2 pb-1 [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/60">
            {attachments.map((file, idx) => (
              <AttachmentCard
                key={`${file.name}-${idx}`}
                file={file}
                onClick={() => {
                  openCanvas(file, { background: false }).catch((err) => {
                    toast.error(err.message || 'Failed to open document');
                  });
                }}
                onRemove={() => {
                  setAttachments((prev) => prev.filter((_, i) => i !== idx));
                }}
              />
            ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          aria-label="Chat message"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          onPaste={(e) => {
            const items = e.clipboardData?.items;
            if (!items) return;
            const pastedFiles: File[] = [];
            for (let i = 0; i < items.length; i++) {
              if (items[i].kind === 'file') {
                const file = items[i].getAsFile();
                if (file) pastedFiles.push(file);
              }
            }
            if (pastedFiles.length > 0) {
              setAttachments((prev) => [...prev, ...pastedFiles]);
              const pdfFile = pastedFiles.find(
                (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
              );
              if (pdfFile) {
                openCanvas(pdfFile, { background: false }).catch((err) => {
                  toast.error(err.message || 'Failed to auto-open pasted document');
                });
              }
            }
          }}
          rows={1}
          disabled={!ready}
          placeholder={isEmpty ? '' : 'Ask Larkup'}
          className="block max-h-44 min-h-[52px] w-full resize-none overflow-y-auto bg-transparent px-12 py-3.5 text-[15px] leading-6 text-[#171717] caret-[#171717] outline-none placeholder:text-[#929292] focus:outline-none focus:ring-0 disabled:opacity-50 dark:text-[#f4f4f4] dark:caret-[#f4f4f4] dark:placeholder:text-[#a6a6a6] [&::-webkit-scrollbar]:hidden"
        />
        {isEmpty && !input && (
          <div className="pointer-events-none absolute top-3.5 right-12 left-12 select-none">
            <AnimatedPlaceholder items={CHAT_SUGGESTIONS} />
          </div>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-label="Add attachment or web search"
                className="absolute bottom-2.5 left-2.5 flex size-8 items-center justify-center rounded-full text-[#454545] transition-colors hover:bg-[#f2f2f2] hover:text-[#171717] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#909090] dark:text-[#dedede] dark:hover:bg-[#393939] dark:hover:text-white"
              >
                <Plus className="size-[18px]" />
              </button>
            }
          />
          <DropdownMenuContent
            side="top"
            align="start"
            className="flex w-56 flex-col gap-1"
            sideOffset={8}
          >
            <DropdownMenuItem
              onClick={(e) => {
                e.preventDefault();
                const fileInput = document.createElement('input');
                fileInput.type = 'file';
                fileInput.multiple = true;
                fileInput.accept = '*/*';
                fileInput.onchange = async (ev: any) => {
                  const fileList = ev.target.files;
                  if (!fileList || fileList.length === 0) return;
                  const newAttachments = Array.from(fileList) as File[];
                  setAttachments((prev) => [...prev, ...newAttachments]);

                  const pdfFile = newAttachments.find(
                    (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
                  );
                  if (pdfFile) {
                    openCanvas(pdfFile, { background: false }).catch((err) => {
                      toast.error(err.message || 'Failed to auto-open document');
                    });
                  }
                };
                fileInput.click();
              }}
              className="cursor-pointer gap-2"
            >
              <Paperclip className="size-4" />
              <span>Attach Document</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.preventDefault();
                handleWebSearchToggle();
              }}
              className="cursor-pointer justify-between gap-2"
            >
              <div className="flex items-center gap-2">
                <Globe className="size-4" />
                <span>Web Search</span>
              </div>
              <Switch
                checked={configData?.config?.webSearchEnabled || false}
                className="pointer-events-none"
              />
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="hidden">
          <FileAttachmentButton id="chat-file-attachment" />
        </div>

        <button
          type="submit"
          disabled={!ready || (!input.trim() && attachments.length === 0)}
          aria-label={isBusy || isDocLoading ? 'Add to queue' : 'Send message'}
          title={isBusy || isDocLoading ? 'Add to queue' : 'Send'}
          className="absolute bottom-2.5 right-2.5 flex size-8 items-center justify-center rounded-full bg-[#0d0d0d] text-white transition-colors hover:bg-[#2b2b2b] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#909090] disabled:cursor-not-allowed disabled:bg-[#b5b5b5] disabled:text-white disabled:hover:bg-[#b5b5b5] dark:bg-[#f4f4f4] dark:text-[#171717] dark:hover:bg-white dark:disabled:bg-[#555555] dark:disabled:text-[#c5c5c5] dark:disabled:hover:bg-[#555555]"
        >
          {isBusy || isDocLoading ? (
            <ListPlus className="size-4" />
          ) : (
            <ArrowUp className="size-4" />
          )}
        </button>
      </div>
    </form>
  );
  return (
    <div
      className={cn(
        'flex h-full w-full flex-1 flex-col overflow-hidden relative',
        isDragging && 'bg-primary/5',
      )}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 z-100 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm border-2 border-dashed border-primary/50 m-4 rounded-3xl pointer-events-none">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 text-primary mb-4">
            <Paperclip className="size-10" />
          </div>
          <h2 className="text-xl font-semibold tracking-tight text-foreground">
            Drop document to attach
          </h2>
          <p className="text-sm text-muted-foreground mt-1">PDF, Word, PPT, TXT</p>
        </div>
      )}
      {/* Header bar */}
      <div className="relative z-40 flex items-center justify-between px-4 py-2">
        <div className="flex items-center gap-3">{/* We moved model selector to the right */}</div>
        <div className="flex items-center gap-2">
          {/* Model selector with search */}
          {status?.availableModels && status.availableModels.length > 0 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowModelSelect((o) => !o)}
                className="flex w-75 justify-between items-center gap-1.5 rounded-lg border border-border bg-white dark:bg-card px-3 py-1.5 text-xs text-foreground transition hover:bg-muted"
              >
                <span className="flex items-center gap-2 truncate">
                  {selectedModelData && (
                    <ProviderIcon
                      src={getProviderMeta(selectedModelData.provider).iconSrc}
                      alt={selectedModelData.provider}
                      pillBg={getProviderMeta(selectedModelData.provider).pillBg}
                      size={16}
                    />
                  )}
                  <span className="truncate">
                    {selectedModelData?.label || selectedModel || 'Select model'}
                  </span>
                </span>
                <ChevronDown
                  className={cn(
                    'size-3 shrink-0 text-muted-foreground transition-transform',
                    showModelSelect && 'rotate-180',
                  )}
                />
              </button>
              {showModelSelect && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowModelSelect(false)} />
                  <div className="absolute right-0 top-full z-50 mt-1 w-75 rounded-lg border border-border bg-card ">
                    {/* Search input */}
                    <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                      <Search className="size-3.5 shrink-0 text-muted-foreground" />
                      <input
                        ref={searchInputRef}
                        type="text"
                        value={modelSearch}
                        onChange={(e) => setModelSearch(e.target.value)}
                        placeholder="Search models..."
                        className="flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
                      />
                      {modelSearch && (
                        <button
                          type="button"
                          onClick={() => setModelSearch('')}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <X className="size-3" />
                        </button>
                      )}
                    </div>

                    {/* Grouped model list */}
                    <div className="max-h-72 overflow-y-auto p-1 [&::-webkit-scrollbar]:hidden">
                      {groupedModels.size === 0 ? (
                        <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                          No models found
                        </div>
                      ) : (
                        Array.from(groupedModels.entries()).map(([provider, models]) => {
                          const meta = getProviderMeta(provider);
                          return (
                            <div key={provider} className="mb-1">
                              <div className="flex items-center gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-foreground/70">
                                {meta.label}
                                <span className="text-[10px] text-muted-foreground/50">
                                  ({models.length})
                                </span>
                              </div>

                              {/* Models */}
                              {models.map((m) => (
                                <button
                                  key={m.id}
                                  type="button"
                                  onClick={() => {
                                    setSelectedModel(m.id);
                                    setShowModelSelect(false);
                                  }}
                                  className={cn(
                                    'flex w-full items-center justify-between rounded-md px-3 py-1.5 text-left text-xs transition',
                                    m.id === selectedModel
                                      ? 'bg-primary/10 text-primary font-medium'
                                      : 'text-foreground hover:bg-muted',
                                  )}
                                >
                                  <span className="flex items-center gap-2 truncate">
                                    <ProviderIcon
                                      src={meta.iconSrc}
                                      alt={meta.label}
                                      pillBg={meta.pillBg}
                                      size={14}
                                    />
                                    <span className="truncate">{m.label}</span>
                                  </span>
                                  <span className="flex items-center gap-1.5 shrink-0 ml-2">
                                    {m.context_window && (
                                      <span className="text-[9px] font-mono text-muted-foreground/60">
                                        {m.context_window >= 1_000_000
                                          ? `${(m.context_window / 1_000_000).toFixed(0)}M`
                                          : `${(m.context_window / 1000).toFixed(0)}K`}
                                      </span>
                                    )}
                                    {/* {m.tags?.includes("reasoning") && (
                                        <span className="rounded bg-violet-100 dark:bg-violet-900/30 px-1 py-0.5 text-[8px] font-medium text-violet-700 dark:text-violet-300">
                                          reasoning
                                        </span>
                                      )} */}
                                  </span>
                                </button>
                              ))}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          <div className="h-4 w-px bg-border mx-1" />

          <TooltipProvider delay={50}>
            <Sheet
              open={isHistoryOpen}
              onOpenChange={(open) => {
                setIsHistoryOpen(open);
                if (!open) setHistorySearch('');
              }}
            >
              <Tooltip>
                <TooltipTrigger
                  render={
                    <SheetTrigger
                      render={
                        <button
                          type="button"
                          aria-label="Chat history"
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                        >
                          <History className="h-4 w-4" />
                        </button>
                      }
                    />
                  }
                />
                <TooltipContent>Chat History</TooltipContent>
              </Tooltip>
              <SheetContent
                side="left"
                showCloseButton={false}
                className="w-75 sm:w-87.5 p-0 flex flex-col"
              >
                <SheetHeader className="p-4 pb-3 border-b">
                  <div className="flex items-center justify-between gap-2">
                    <SheetTitle className="text-sm font-semibold">Chat History</SheetTitle>
                    <div className="flex items-center gap-1">
                      <AlertDialog>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <AlertDialogTrigger
                                render={
                                  <button
                                    type="button"
                                    aria-label="Clear chat history"
                                    disabled={history.length === 0}
                                    className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-40"
                                  >
                                    <Trash2 className="size-3.5" />
                                  </button>
                                }
                              />
                            }
                          />
                          <TooltipContent>Clear all chat history</TooltipContent>
                        </Tooltip>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete all chat history?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will permanently delete all saved chats on this device. This
                              action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => void deleteAllChats()}
                              className="bg-destructive text-white hover:bg-destructive/90"
                            >
                              Delete all
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                      <SheetClose
                        render={
                          <button
                            type="button"
                            aria-label="Close chat history"
                            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                          >
                            <X className="size-3.5" />
                          </button>
                        }
                      />
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-2.5 py-1.5">
                    <Search className="size-3.5 shrink-0 text-muted-foreground" />
                    <input
                      type="text"
                      value={historySearch}
                      onChange={(e) => setHistorySearch(e.target.value)}
                      placeholder="Search chats..."
                      className="flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
                    />
                    {historySearch && (
                      <button
                        type="button"
                        onClick={() => setHistorySearch('')}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <X className="size-3" />
                      </button>
                    )}
                  </div>
                </SheetHeader>
                <div className="flex-1 overflow-y-auto p-2">
                  {history.length === 0 ? (
                    <div className="p-4 text-center text-xs text-muted-foreground">
                      No chat history
                    </div>
                  ) : filteredHistory.length === 0 ? (
                    <div className="p-4 text-center text-xs text-muted-foreground">
                      No chats match "{historySearch}"
                    </div>
                  ) : (
                    filteredHistory.map((chat) => (
                      <div
                        key={chat.id}
                        onClick={() => loadChat(chat.id)}
                        className={cn(
                          'group flex items-center justify-between rounded-md px-3 py-2 text-sm cursor-pointer transition hover:bg-muted mb-1',
                          currentChatId === chat.id && 'bg-muted font-medium',
                        )}
                      >
                        <div className="truncate pr-4 flex-1 text-xs">{chat.title}</div>
                        <AlertDialog>
                          <AlertDialogTrigger
                            render={
                              <button
                                onClick={(e) => e.stopPropagation()}
                                className="text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:text-destructive"
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            }
                          />
                          <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Chat</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to delete this chat? This action cannot be
                                undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteChat(chat.id)}
                                className="bg-destructive text-white hover:bg-destructive/90"
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    ))
                  )}
                </div>
              </SheetContent>
            </Sheet>

            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={newChat}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                  >
                    <SquarePen className="h-4 w-4" />
                  </button>
                }
              />
              <TooltipContent>New Chat</TooltipContent>
            </Tooltip>
            <JobsTrackingButton />
          </TooltipProvider>
        </div>
      </div>

      {/* Messages area */}
      {ready && isEmpty ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-6 overflow-y-auto px-4 py-6 sm:px-6 [&::-webkit-scrollbar]:hidden -translate-y-[10vh]">
          <h1 className="text-center text-[23px] font-normal tracking-tight text-[#171717] dark:text-[#f4f4f4] sm:text-[25px]">
            {greeting}
          </h1>
          <div className="w-full max-w-3xl">{composerForm}</div>
        </div>
      ) : (
        <>
          <ChatMessagesViewport viewportRef={scrollRef} onScroll={handleMessageScroll}>
            {!ready ? (
              <div className="flex flex-col items-center justify-center gap-3 pt-[18vh] text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white border text-muted-foreground">
                  {statusLoading ? (
                    <Loader2 className="size-6 animate-spin" />
                  ) : (
                    <MessageCircle className="size-7" />
                  )}
                </div>
                <h1 className="text-xl font-semibold tracking-tight text-foreground">
                  {statusLoading
                    ? 'Preparing your workspace'
                    : statusError
                      ? 'Chat temporarily unavailable'
                      : 'Setup Required'}
                </h1>
                <p className="max-w-md text-sm leading-relaxed text-muted-foreground mb-2">
                  {statusLoading
                    ? 'Loading your chat configuration and available models…'
                    : statusError
                      ? 'Chat services are temporarily unavailable. Larkup will retry automatically.'
                      : status?.blockers?.join(' ') ||
                        'Connect a chat model in Settings to start chatting.'}
                </p>
                {!statusLoading && !statusError && (
                  <a
                    href={
                      status?.blockers?.some((b) => b.includes('API Key') || b.includes('Settings'))
                        ? '/settings/models'
                        : '/settings'
                    }
                    className="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
                  >
                    Go to Settings
                  </a>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-0">
                {messages.map((m, idx) => (
                  <MessageItem
                    key={m.id}
                    message={m}
                    isLast={idx === messages.length - 1}
                    isStreaming={chatStatus === 'streaming'}
                    addToolResult={addToolResult}
                    serverId={projectId}
                    autoOpenSupportingClip={shouldAutoOpenSupportingClip(messages, idx)}
                    regenerate={regenerate}
                    isBusy={isBusy}
                    onFeedback={handleMessageFeedback}
                  />
                ))}
                {chatStatus === 'submitted' || isInitializingChat ? (
                  <ThinkingIndicator steps={GENERIC_THINKING_STEPS} icon={GENERIC_THINKING_ICON} />
                ) : null}
                {error
                  ? (() => {
                      const raw =
                        error.message || 'Something went wrong while generating a response.';
                      // Sanitize: if the message contains URLs or is too long, clean it up
                      let displayMessage = raw;
                      if (
                        raw.includes('rate-limited') ||
                        raw.includes('rate_limit') ||
                        raw.includes('429')
                      ) {
                        displayMessage =
                          'Vercel AI Gateway could not serve this model because it is rate-limited. We tried compatible backups. Try again shortly, choose another model, or add AI Gateway credits / a provider key in Settings.';
                      } else if (raw.includes('unavailable tool') || raw.includes('NoSuchTool')) {
                        displayMessage =
                          'The model tried an unavailable action. Please try your question again.';
                      } else if (
                        raw.length > 200 ||
                        raw.includes('http://') ||
                        raw.includes('https://')
                      ) {
                        displayMessage =
                          'Something went wrong while generating a response. Please try again.';
                      }
                      return (
                        <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3">
                          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                          <div className="flex-1">
                            <p className="text-sm text-foreground">{displayMessage}</p>
                            <button
                              type="button"
                              onClick={() => regenerate()}
                              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground transition hover:bg-secondary"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                              Try again
                            </button>
                          </div>
                        </div>
                      );
                    })()
                  : null}
              </div>
            )}
          </ChatMessagesViewport>

          {/* Input area */}
          {ready && (
            <div className="relative z-10 mt-auto px-4 pb-5 pt-3 sm:px-6">
              {queuedMessages.length > 0 && (
                <MessageQueue
                  items={queuedMessages}
                  onRemove={removeFromQueue}
                  onMoveUp={(id) => moveQueueItem(id, -1)}
                  onMoveDown={(id) => moveQueueItem(id, 1)}
                  onEdit={editQueueItem}
                />
              )}
              {composerForm}
            </div>
          )}
        </>
      )}
    </div>
  );
}
