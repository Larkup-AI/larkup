"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
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
} from "lucide-react";
import useSWR from "swr";
import { MessageItem } from "@/components/chat/message-item";
import { ChatSettingsModal } from "@/components/chat/chat-settings-modal";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import { cn } from "@/lib/utils";
import { getProviderMeta, ProviderIcon } from "@/components/ui/provider-icon";

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
  const { activeServer } = useWorkspace();
  const serverId = activeServer?.id ?? null;

  const statusKey = serverId
    ? `/api/chat/status?serverId=${encodeURIComponent(serverId)}`
    : "/api/chat/status";
  const { data: status, isLoading: statusLoading } = useSWR<ChatStatus>(
    statusKey,
    fetcher,
    { refreshInterval: 10000 },
  );

  const [selectedModel, setSelectedModel] = useState<string>("");
  const [showModelSelect, setShowModelSelect] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [input, setInput] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

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
      setModelSearch("");
    }
  }, [showModelSelect]);

  // Fetch suggestions if missing
  useEffect(() => {
    if (
      status?.ready &&
      status.suggestions &&
      status.suggestions.length === 0
    ) {
      const url = serverId
        ? `/api/chat/suggestions?serverId=${encodeURIComponent(serverId)}`
        : "/api/chat/suggestions";
      fetch(url, { method: "POST" });
    }
  }, [status?.ready, status?.suggestions, serverId]);

  const {
    messages,
    sendMessage,
    status: chatStatus,
    setMessages,
    error,
    regenerate,
  } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      body: {
        serverId,
        chatModelId: selectedModel || undefined,
      },
    }),
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  const isBusy = chatStatus === "submitted" || chatStatus === "streaming";

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, chatStatus]);

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
    setInput("");
  }

  function newChat() {
    setMessages([]);
    setInput("");
  }

  const isEmpty = messages.length === 0;
  const ready = status?.ready ?? false;
  const selectedModelData = status?.availableModels?.find(
    (m) => m.id === selectedModel,
  );

  if (statusLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-border px-6 pb-3">
        <div className="flex items-center gap-3">
          {/* We moved model selector to the right */}
        </div>
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
                      pillBg={
                        getProviderMeta(selectedModelData.provider).pillBg
                      }
                      size={16}
                    />
                  )}
                  <span className="truncate">
                    {selectedModelData?.label ||
                      selectedModel ||
                      "Select model"}
                  </span>
                </span>
                <ChevronDown
                  className={cn(
                    "size-3 shrink-0 text-muted-foreground transition-transform",
                    showModelSelect && "rotate-180",
                  )}
                />
              </button>
              {showModelSelect && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowModelSelect(false)}
                  />
                  <div className="absolute right-0 top-full z-50 mt-1 w-[300px] rounded-lg border border-border bg-card shadow-lg">
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
                          onClick={() => setModelSearch("")}
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
                        Array.from(groupedModels.entries()).map(
                          ([provider, models]) => {
                            const meta = getProviderMeta(provider);
                            return (
                              <div key={provider} className="mb-1">
                                {/* Provider group header */}
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
                                      "flex w-full items-center justify-between rounded-md px-3 py-1.5 text-left text-xs transition",
                                      m.id === selectedModel
                                        ? "bg-primary/10 text-primary font-medium"
                                        : "text-foreground hover:bg-muted",
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
                          },
                        )
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          <div className="h-4 w-px bg-border mx-1" />

          <button
            type="button"
            onClick={newChat}
            title="New chat"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-secondary hover:text-foreground"
          >
            <SquarePen className="h-[16px] w-[16px]" />
          </button>
          <ChatSettingsModal />
        </div>
      </div>

      {/* Messages area */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden"
      >
        <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
          {!ready ? (
            <div className="flex flex-col items-center justify-center gap-3 pt-[18vh] text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                <MessageCircle className="size-7" />
              </div>
              <h1 className="text-xl font-semibold tracking-tight text-foreground">
                Chat not ready yet
              </h1>
              <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
                {status?.blockers?.join(" ") ||
                  "Set an API key in Settings to start chatting."}
              </p>
            </div>
          ) : isEmpty ? (
            <div className="flex flex-col items-center justify-center gap-3 pt-[18vh] text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <MessageCircle className="size-7" />
              </div>
              <h1 className="text-xl font-semibold tracking-tight text-foreground text-balance">
                Chat with your knowledge base
              </h1>
              <p className="max-w-md text-sm leading-relaxed text-muted-foreground text-pretty">
                Ask questions and get AI-powered answers grounded in your
                indexed documents.
              </p>
              {!status?.indexed && (
                <div className="mt-2 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  <TriangleAlert className="size-3.5 shrink-0" />
                  No documents indexed yet, add documents in the Docs page. The
                  agent can still answer general questions.
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
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {/* <Loader2 className="size-3 animate-spin" /> Generating
                    suggestions... */}
                  </div>
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
                  isStreaming={chatStatus === "streaming"}
                />
              ))}
              {chatStatus === "submitted" ? (
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
                      {error.message ||
                        "Something went wrong while generating a response."}
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
        <div className="relative z-10000 px-4 pb-5 pt-3 sm:px-6">
          <form onSubmit={handleSubmit} className="mx-auto w-full max-w-3xl">
            <div className="flex items-end gap-2 rounded-2xl border border-border bg-card p-2 transition focus-within:ring-1 focus-within:ring-ring">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit(e);
                  }
                }}
                rows={2}
                disabled={!ready}
                placeholder="Ask about your knowledge base…"
                className="max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
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
