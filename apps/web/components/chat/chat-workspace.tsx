'use client';

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
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
} from 'lucide-react';
import useSWR from 'swr';
import { MessageItem } from '@/components/chat/message-item';
import { ChatSettingsModal } from '@/components/chat/chat-settings-modal';
import { useWorkspace } from '@/components/workspace/workspace-provider';
import { cn } from '@/lib/utils';
import { getProviderMeta, ProviderIcon } from '@/components/ui/provider-icon';
import { get, set, del } from 'idb-keyval';
import { useRouter } from 'next/navigation';
import { useChatStore } from '@/store/chat-store';
import { toast } from 'sonner';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
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
} from '@/components/ui/alert-dialog';
import { DocEditorProvider, useDocEditor } from '@/components/chat/canvas/doc-editor-provider';
import { DocumentCanvas } from '@/components/chat/canvas/document-canvas';
import { FileAttachmentButton } from '@/components/chat/canvas/file-attachment-button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface AvailableModel {
  id: string;
  label: string;
  provider: string;
  context_window?: number;
  tags?: string[];
}

interface ChatStatus {
  ready: boolean;
  indexed: boolean;
  blockers: string[];
  provider: string;
  chatModelId: string;
  availableModels: AvailableModel[];
  suggestions: string[];
}

export function ChatWorkspace() {
  return (
    <DocEditorProvider>
      <DocumentCanvas>
        <ChatWorkspaceInner />
      </DocumentCanvas>
    </DocEditorProvider>
  );
}

function ChatWorkspaceInner() {
  const { activeServer } = useWorkspace();
  const { sessionId, parsedDocument } = useDocEditor();
  const docEditorState = { sessionId, fields: parsedDocument?.fields || [] };
  const serverId = activeServer?.id ?? null;

  const statusKey = serverId
    ? `/api/chat/status?serverId=${encodeURIComponent(serverId)}`
    : '/api/chat/status';
  const { data: status, isLoading: statusLoading } = useSWR<ChatStatus>(statusKey, fetcher, {
    refreshInterval: 10000,
  });

  const { data: configData, mutate: mutateConfig } = useSWR('/api/config', fetcher);
  const router = useRouter();

  const { selectedModel, setSelectedModel } = useChatStore();
  const [showModelSelect, setShowModelSelect] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [input, setInput] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  const [currentChatId, setCurrentChatId] = useState<string>('');
  const [history, setHistory] = useState<{ id: string; title: string; updatedAt: number }[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  // Load history on mount
  useEffect(() => {
    get('chat_sessions').then((val) => {
      if (val) setHistory(val);
    });
  }, []);

  // Update selected model when status loads
  useEffect(() => {
    if (status?.chatModelId && !selectedModel) {
      setSelectedModel(status.chatModelId);
    }
  }, [status?.chatModelId, selectedModel]);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (showModelSelect) {
      // Small delay to let the DOM render
      requestAnimationFrame(() => searchInputRef.current?.focus());
    } else {
      setModelSearch('');
    }
  }, [showModelSelect]);

  // Fetch suggestions if missing
  useEffect(() => {
    if (status?.ready && status.suggestions && status.suggestions.length === 0) {
      const url = serverId
        ? `/api/chat/suggestions?serverId=${encodeURIComponent(serverId)}`
        : '/api/chat/suggestions';
      fetch(url, { method: 'POST' });
    }
  }, [status?.ready, status?.suggestions, serverId]);

  const chatBody = useMemo(
    () => ({
      serverId,
      chatModelId: selectedModel || undefined,
      docSessionId: docEditorState.sessionId,
      docFields: docEditorState.fields,
    }),
    [serverId, selectedModel, docEditorState.sessionId, JSON.stringify(docEditorState.fields)],
  );

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/chat',
        headers: {
          'Content-Type': 'application/json',
        },
        prepareSendMessagesRequest({ messages, id, body }) {
          return {
            body: {
              messages,
              id,
              ...chatBody,
              ...body,
            },
          };
        },
      }),
    [chatBody],
  );

  const {
    messages,
    sendMessage,
    status: chatStatus,
    setMessages,
    error,
    regenerate,
  } = useChat({
    transport,
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  const isBusy = chatStatus === 'submitted' || chatStatus === 'streaming';

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const id = requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(id);
  }, [messages, chatStatus]);

  // Save messages to history — debounced to prevent cascading re-renders during streaming
  const historySaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

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

      set(`chat_messages_${activeId}`, currentMessages);

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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || isBusy) return;
    sendMessage({ text });
    setInput('');
  }

  function newChat() {
    setMessages([]);
    setInput('');
    setCurrentChatId(crypto.randomUUID());
  }

  useEffect(() => {
    const handleNewChat = () => newChat();
    window.addEventListener('new-chat', handleNewChat);
    return () => window.removeEventListener('new-chat', handleNewChat);
  }, []);

  async function handleWebSearchToggle() {
    const config = configData?.config;
    if (!config) return;

    const isTavily = config.webSearchProvider === 'tavily' || !config.webSearchProvider;
    const hasKey = isTavily ? !!config.tavilyApiKey : !!config.serperApiKey; // Server uses its own or serper, fallback to check serper or just assume server doesn't need one if it's configured. Let's just check tavily if tavily.

    if (isTavily && !config.tavilyApiKey && !config.serperApiKey) {
      toast.error('Web Search API key is missing. Please configure it in Settings.');
      router.push('/settings');
      return;
    }

    const nextState = !config.webSearchEnabled;
    try {
      await fetch('/api/config', {
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
    }
  }

  const isEmpty = messages.length === 0;
  const ready = status?.ready ?? false;
  const selectedModelData = status?.availableModels?.find((m) => m.id === selectedModel);

  if (statusLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-1 flex-col overflow-hidden">
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
                className="flex w-[300px] justify-between items-center gap-1.5 rounded-lg border border-border bg-white dark:bg-card px-3 py-1.5 text-xs text-foreground transition hover:bg-muted"
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
                  <div className="absolute right-0 top-full z-50 mt-1 w-[300px] rounded-lg border border-border bg-card ">
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
            <Sheet open={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <SheetTrigger
                      render={
                        <button
                          type="button"
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                        >
                          <History className="h-[16px] w-[16px]" />
                        </button>
                      }
                    />
                  }
                />
                <TooltipContent>Chat History</TooltipContent>
              </Tooltip>
              <SheetContent side="left" className="w-[300px] sm:w-[350px] p-0 flex flex-col">
                <SheetHeader className="p-4 border-b">
                  <SheetTitle className="text-sm font-semibold">Chat History</SheetTitle>
                </SheetHeader>
                <div className="flex-1 overflow-y-auto p-2">
                  {history.length === 0 ? (
                    <div className="p-4 text-center text-xs text-muted-foreground">
                      No chat history
                    </div>
                  ) : (
                    history
                      .sort((a, b) => b.updatedAt - a.updatedAt)
                      .map((chat) => (
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
                    <SquarePen className="h-[16px] w-[16px]" />
                  </button>
                }
              />
              <TooltipContent>New Chat</TooltipContent>
            </Tooltip>
            <ChatSettingsModal />
          </TooltipProvider>
        </div>
      </div>

      {/* Messages area */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden">
        <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
          {!ready ? (
            <div className="flex flex-col items-center justify-center gap-3 pt-[18vh] text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white border text-muted-foreground">
                <MessageCircle className="size-7" />
              </div>
              <h1 className="text-xl font-semibold tracking-tight text-foreground">
                Setup Required
              </h1>
              <p className="max-w-md text-sm leading-relaxed text-muted-foreground mb-2">
                {status?.blockers?.join(' ') || 'Set an API key in Settings to start chatting.'}
              </p>
              <a
                href={
                  status?.blockers?.some((b) => b.includes('API Key') || b.includes('Settings'))
                    ? '/settings?ai-models'
                    : '/settings'
                }
                className="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
              >
                Go to Settings
              </a>
            </div>
          ) : isEmpty ? (
            <div className="flex flex-col items-center justify-center gap-3 pt-[18vh] text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white border border-border/60 text-primary ">
                <MessageCircle className="size-7" />
              </div>
              <h1 className="text-xl font-semibold tracking-tight text-foreground text-balance">
                Chat with your knowledge base
              </h1>
              <p className="max-w-md text-sm leading-relaxed text-muted-foreground text-pretty">
                Ask questions and get AI-powered answers grounded in your indexed documents.
              </p>
              {!status?.indexed && (
                <div className="mt-2 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  <TriangleAlert className="size-3.5 shrink-0" />
                  No documents indexed yet, add documents in the Docs page. The agent can still
                  answer general questions.
                </div>
              )}
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {status?.suggestions && status.suggestions.length > 0 ? (
                  status.suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        sendMessage({ text: s });
                      }}
                      className="rounded-full border border-border bg-card px-3.5 py-1.5 text-xs text-foreground transition hover:bg-secondary"
                    >
                      {s}
                    </button>
                  ))
                ) : (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground"></div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {messages.map((m, idx) => (
                <MessageItem
                  key={m.id}
                  message={m}
                  isLast={idx === messages.length - 1}
                  isStreaming={chatStatus === 'streaming'}
                />
              ))}
              {chatStatus === 'submitted' ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-foreground" />
                  Thinking…
                </div>
              ) : null}
              {error ? (
                <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  <div className="flex-1">
                    <p className="text-sm text-foreground">
                      {error.message || 'Something went wrong while generating a response.'}
                    </p>
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
              ) : null}
            </div>
          )}
        </div>
      </div>

      {/* Input area */}
      {ready && (
        <div className="relative z-10 mt-auto px-4 pb-5 pt-3 sm:px-6">
          <form onSubmit={handleSubmit} className="mx-auto w-full max-w-3xl">
            <div className="flex items-end gap-2 rounded-2xl border border-border bg-card p-2 transition focus-within:ring-1 focus-within:ring-ring">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <button
                      type="button"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                    >
                      <Plus className="h-[18px] w-[18px]" />
                    </button>
                  }
                />
                <DropdownMenuContent
                  side="top"
                  align="start"
                  className="w-56 gap-1 flex flex-col"
                  sideOffset={8}
                >
                  {/* File Attachment Button hidden input, clicked programmatically */}
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.preventDefault();
                      const fileInput = document.getElementById(
                        'chat-file-attachment',
                      ) as HTMLInputElement;
                      fileInput?.click();
                    }}
                    className="gap-2 cursor-pointer"
                  >
                    <Paperclip className="size-4" />
                    <span>Attach Document</span>
                  </DropdownMenuItem>
                  {/* <DropdownMenuSeparator /> */}
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.preventDefault();
                      handleWebSearchToggle();
                    }}
                    className="gap-2 justify-between cursor-pointer"
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
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit(e);
                  }
                }}
                rows={1}
                disabled={!ready}
                placeholder="How can I help you…"
                className="max-h-48 min-h-[44px] flex-1 resize-none bg-transparent px-2 py-3 text-[15px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-scrollbar]:hidden"
              />
              <button
                type="submit"
                disabled={!input.trim() || isBusy}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition hover:opacity-90 disabled:opacity-40"
              >
                {isBusy ? (
                  <Loader2 className="h-[18px] w-[18px] animate-spin" />
                ) : (
                  <ArrowUp className="h-[18px] w-[18px]" />
                )}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
