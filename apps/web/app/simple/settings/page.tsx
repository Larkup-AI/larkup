"use client";

import { useState, useEffect } from "react";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import {
  Eye,
  EyeOff,
  Loader2,
  Save,
  Copy,
  CheckCircle2,
  RefreshCw,
  Server,
  Key,
  Sparkles,
  MessageCircle,
  Settings2,
  Database,
  Clock,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import { PROVIDER_META, ProviderIcon } from "@/components/ui/provider-icon";
import { LaunchPanel } from "@/components/server/server-workspace";
import {
  VECTOR_STORE_LIST,
  getVectorStore,
} from "@larkup-rag/vector-stores/registry";
import { StoreFields } from "@/components/configure/store-fields";
import type { RagConfig, VectorStoreId } from "@larkup-rag/core/types";

const fetcher = (url: string) =>
  fetch(url).then((r) => r.json() as Promise<{ config: RagConfig }>);

const PROVIDER_LIST = [
  "vercel_ai_gateway",
  "openai",
  "google",
  "deepseek",
  "mistral",
  "voyage",
  "jina",
  "nomic",
] as const;

type StoreMeta = { iconSrc: string; pillBg: string };
const STORE_META: Record<string, StoreMeta> = {
  lancedb: {
    iconSrc: "/icons/lancedb2.png",
    pillBg: "bg-yellow-50 dark:bg-yellow-950/40",
  },
  pinecone: {
    iconSrc: "/icons/pinecone.png",
    pillBg: "bg-green-50 dark:bg-green-950/40",
  },
};

export default function SimpleSettingsPage() {
  const router = useRouter();
  const { activeServer, setMode } = useWorkspace();
  const serverId = activeServer?.id;

  const configUrl = serverId
    ? `/api/config?serverId=${encodeURIComponent(serverId)}`
    : "/api/config";
  const { data, isLoading, mutate } = useSWR(configUrl, fetcher);

  const [form, setForm] = useState<Partial<RagConfig>>({});
  const [saving, setSaving] = useState(false);
  const [showEmbeddingKey, setShowEmbeddingKey] = useState(false);
  const [showChatKey, setShowChatKey] = useState(false);
  const [serverApiKey, setServerApiKey] = useState("");
  const [copiedKey, setCopiedKey] = useState(false);

  useEffect(() => {
    if (data?.config) {
      setForm(data.config);
    }
  }, [data]);

  useEffect(() => {
    const saved = localStorage.getItem("rag_server_api_key");
    if (saved) setServerApiKey(saved);
  }, []);

  const dirty = JSON.stringify(form) !== JSON.stringify(data?.config ?? {});

  async function handleSave() {
    if (!data?.config) return;
    setSaving(true);
    try {
      const merged = { ...data.config, ...form };
      const res = await fetch(configUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(merged),
      });
      const json = await res.json();
      if (!res.ok)
        throw new Error(json.error ?? "Failed to save configuration");
      await mutate(json, { revalidate: false });
      toast.success("Settings saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const selectStore = (id: VectorStoreId) => {
    setForm((f) => ({
      ...f,
      vectorStore: id,
      storeConfig: {},
    }));
  };

  const setStoreValue = (key: string, value: string) => {
    setForm((f) => ({ ...f, storeConfig: { ...f.storeConfig, [key]: value } }));
  };

  function handleServerApiKeyChange(v: string) {
    setServerApiKey(v);
    localStorage.setItem("rag_server_api_key", v);
  }

  function generateApiKey() {
    const key =
      "sk-" +
      Array.from(crypto.getRandomValues(new Uint8Array(24)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    handleServerApiKeyChange(key);
    toast.success("API key generated");
  }

  async function copyApiKey() {
    await navigator.clipboard.writeText(serverApiKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 1500);
  }

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-5 pb-4 md:px-8">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-foreground">
            Settings
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage your AI providers, API keys, and server configuration.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            size="lg"
            variant="outline"
            onClick={async () => {
              await setMode("tech");
              router.push("/configure");
            }}
            className="px-3.5 h-9.5 rounded-md transition-all text-[13px]"
          >
            Developer Mode
          </Button>
          <Button
            size="lg"
            variant="default"
            disabled={saving || !dirty}
            onClick={handleSave}
            className="min-w-[110px] px-3.5 h-9.5 rounded-md transition-all text-white/90 text-[13px]"
          >
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Save className="size-4" />
                Save Settings
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 pb-8 md:px-8">
        <div className="mx-auto max-w-3xl space-y-6 pt-1">
          {/* ── AI Provider & Keys ────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="size-4 text-primary" />
                Embedding Provider
              </CardTitle>
              <CardDescription className="text-xs">
                Used to generate vector embeddings for your documents.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Provider</Label>
                <Select
                  value={form.embeddingProvider ?? "openai"}
                  onValueChange={(v: any) =>
                    setForm({ ...form, embeddingProvider: v })
                  }
                >
                  <SelectTrigger className="w-full">
                    <span className="flex items-center gap-2">
                      {PROVIDER_META[
                        (form.embeddingProvider ??
                          "openai") as keyof typeof PROVIDER_META
                      ] ? (
                        <>
                          <ProviderIcon
                            src={
                              PROVIDER_META[
                                form.embeddingProvider as keyof typeof PROVIDER_META
                              ]?.iconSrc ?? ""
                            }
                            alt={
                              PROVIDER_META[
                                form.embeddingProvider as keyof typeof PROVIDER_META
                              ]?.label ?? ""
                            }
                            pillBg={
                              PROVIDER_META[
                                form.embeddingProvider as keyof typeof PROVIDER_META
                              ]?.pillBg ?? undefined
                            }
                            size={16}
                          />
                          {PROVIDER_META[
                            form.embeddingProvider as keyof typeof PROVIDER_META
                          ]?.label ?? form.embeddingProvider}
                        </>
                      ) : (
                        form.embeddingProvider || "Select provider"
                      )}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDER_LIST.map((key) => {
                      const meta =
                        PROVIDER_META[key as keyof typeof PROVIDER_META];
                      if (!meta) return null;
                      return (
                        <SelectItem key={key} value={key}>
                          <div className="flex items-center gap-2">
                            <ProviderIcon
                              src={meta.iconSrc}
                              alt={meta.label}
                              pillBg={meta.pillBg ?? undefined}
                              size={16}
                            />
                            <span>
                              {meta.label}
                              {key === "vercel_ai_gateway" && " (Recommended)"}
                            </span>
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">API Key</Label>
                <div className="relative">
                  <Input
                    type={showEmbeddingKey ? "text" : "password"}
                    value={form.embeddingApiKey || ""}
                    onChange={(e) =>
                      setForm({ ...form, embeddingApiKey: e.target.value })
                    }
                    placeholder="sk-..."
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowEmbeddingKey(!showEmbeddingKey)}
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
                  >
                    {showEmbeddingKey ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ── Chat (LLM) Provider ───────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <MessageCircle className="size-4 text-primary" />
                Chat (LLM) Provider
              </CardTitle>
              <CardDescription className="text-xs">
                Used to answer questions based on retrieved documents. Leave
                blank to use the same provider and key as embedding.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Provider</Label>
                <Select
                  value={
                    form.chatProvider || form.embeddingProvider || "openai"
                  }
                  onValueChange={(v: any) =>
                    setForm({ ...form, chatProvider: v })
                  }
                >
                  <SelectTrigger className="w-full">
                    <span className="flex items-center gap-2">
                      {(() => {
                        const pKey =
                          form.chatProvider ||
                          form.embeddingProvider ||
                          "openai";
                        const meta =
                          PROVIDER_META[pKey as keyof typeof PROVIDER_META];
                        return meta ? (
                          <>
                            <ProviderIcon
                              src={meta.iconSrc}
                              alt={meta.label}
                              pillBg={meta.pillBg ?? undefined}
                              size={16}
                            />
                            {meta.label}
                          </>
                        ) : (
                          pKey
                        );
                      })()}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDER_LIST.map((key) => {
                      const meta =
                        PROVIDER_META[key as keyof typeof PROVIDER_META];
                      if (!meta) return null;
                      return (
                        <SelectItem key={key} value={key}>
                          <div className="flex items-center gap-2">
                            <ProviderIcon
                              src={meta.iconSrc}
                              alt={meta.label}
                              pillBg={meta.pillBg}
                              size={16}
                            />
                            <span>{meta.label}</span>
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">API Key</Label>
                <div className="relative">
                  <Input
                    type={showChatKey ? "text" : "password"}
                    value={form.chatApiKey || ""}
                    onChange={(e) =>
                      setForm({ ...form, chatApiKey: e.target.value })
                    }
                    placeholder="Leave blank to use embedding key"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowChatKey(!showChatKey)}
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
                  >
                    {showChatKey ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ── System Prompt ─────────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Settings2 className="size-4 text-primary" />
                System Prompt
              </CardTitle>
              <CardDescription className="text-xs">
                Override the default instructions given to the chat agent. Leave
                blank for the default RAG prompt.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <textarea
                value={form.systemPrompt || ""}
                onChange={(e) =>
                  setForm({ ...form, systemPrompt: e.target.value })
                }
                placeholder="You are a helpful research assistant..."
                rows={5}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary focus:ring-1 focus:ring-primary resize-y min-h-[100px]"
              />
            </CardContent>
          </Card>

          {/* ── Vector Store ──────────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Database className="size-4 text-primary" />
                Vector Store
              </CardTitle>
              <CardDescription className="text-xs">
                Choose where your document vectors are stored.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label className="text-xs">Vector Store</Label>
                <Select
                  value={form.vectorStore}
                  onValueChange={(v) => selectStore(v as VectorStoreId)}
                >
                  <SelectTrigger className="w-full">
                    {form.vectorStore ? (
                      <span className="flex items-center gap-2.5">
                        <ProviderIcon
                          src={STORE_META[form.vectorStore]?.iconSrc ?? ""}
                          alt={
                            getVectorStore(form.vectorStore)?.label ??
                            form.vectorStore
                          }
                          pillBg={
                            STORE_META[form.vectorStore]?.pillBg ?? undefined
                          }
                          size={16}
                        />
                        <span className="font-medium text-sm">
                          {getVectorStore(form.vectorStore)?.label ??
                            form.vectorStore}
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        Select a vector store…
                      </span>
                    )}
                  </SelectTrigger>
                  <SelectContent>
                    {VECTOR_STORE_LIST.map((s) => {
                      const meta = STORE_META[s.id];
                      const isComingSoon = s.installStatus === "coming-soon";
                      return (
                        <SelectItem
                          key={s.id}
                          value={s.id}
                          disabled={isComingSoon}
                          className={isComingSoon ? "opacity-50" : ""}
                        >
                          <span className="flex items-center gap-2.5 w-full">
                            {meta && (
                              <ProviderIcon
                                src={meta.iconSrc}
                                alt={s.label}
                                pillBg={meta.pillBg ?? undefined}
                                size={16}
                              />
                            )}
                            <span className="flex flex-col flex-1 min-w-0">
                              <span className="flex items-center gap-2">
                                <span className="font-medium text-sm">
                                  {s.label}
                                </span>
                                {isComingSoon && (
                                  <span className="h-3.5 px-1 text-[9px] font-medium shrink-0 text-muted-foreground border rounded-full flex items-center bg-transparent">
                                    <Clock className="size-2.5 mr-0.5" />
                                    Coming Soon
                                  </span>
                                )}
                              </span>
                            </span>
                          </span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>

              {form.vectorStore && (
                <div className="border-t pt-4">
                  <StoreFields
                    store={getVectorStore(form.vectorStore)}
                    values={form.storeConfig || {}}
                    errors={{}}
                    onChange={setStoreValue}
                    indexType={form.indexType || "hybrid"}
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Server API Key ────────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Key className="size-4 text-primary" />
                Server API Key
              </CardTitle>
              <CardDescription className="text-xs">
                Protect your RAG server with an API key. Clients must send this
                key in the{" "}
                <code className="text-[11px] bg-muted px-1 py-0.5 rounded">
                  Authorization
                </code>{" "}
                header.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                <Input
                  type="text"
                  value={serverApiKey}
                  onChange={(e) => handleServerApiKeyChange(e.target.value)}
                  placeholder="sk-..."
                  className="flex-1 font-mono text-xs"
                />
                <Button
                  variant="outline"
                  size="icon"
                  className="shrink-0 h-9 w-9"
                  onClick={copyApiKey}
                  disabled={!serverApiKey}
                >
                  {copiedKey ? (
                    <CheckCircle2 className="size-4 text-primary" />
                  ) : (
                    <Copy className="size-4" />
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 gap-1.5"
                  onClick={generateApiKey}
                >
                  <RefreshCw className="size-3.5" />
                  Generate
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Stored locally in your browser. Generate a new key or paste your
                own.
              </p>
            </CardContent>
          </Card>

          {/* ── RAG Server Launch ─────────────────────────────────────── */}
          <LaunchPanel serverId={serverId || "default"} />
        </div>
      </div>
    </div>
  );
}
