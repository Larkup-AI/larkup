"use client";

import { useState, useEffect, useMemo } from "react";
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
  Key,
  Sparkles,
  MessageCircle,
  Settings2,
  Database,
  Clock,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectGroup,
  SelectLabel,
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
import { ServerFormDialog } from "@/components/workspace/server-form-dialog";
import {
  VECTOR_STORE_LIST,
  getVectorStore,
  validateStoreConfig,
} from "@larkup/vector-stores/registry";
import { StoreFields } from "@/components/configure/store-fields";
import { CustomModelModal } from "@/components/configure/custom-model-modal";
import type {
  RagConfig,
  VectorStoreId,
  CustomModelConfig,
  EmbeddingModelDescriptor,
} from "@larkup/core/types";

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

  const currentChatProvider = form.chatProvider || form.embeddingProvider || "openai";
  const statusKey = serverId
    ? `/api/chat/status?serverId=${encodeURIComponent(serverId)}&provider=${currentChatProvider}`
    : `/api/chat/status?provider=${currentChatProvider}`;
  const { data: chatStatus } = useSWR(statusKey, (url: string) => fetch(url).then(r => r.json()));

  // Build embedding models grouped by provider from the dynamic API response
  const embeddingModels: EmbeddingModelDescriptor[] = chatStatus?.availableEmbeddingModels ?? [];
  const EMBEDDING_BY_PROVIDER = useMemo(() => {
    return embeddingModels.reduce<Record<string, EmbeddingModelDescriptor[]>>((acc, m) => {
      (acc[m.provider] ??= []).push(m);
      return acc;
    }, {});
  }, [embeddingModels]);
  const [showChatKey, setShowChatKey] = useState(false);
  const [serverApiKey, setServerApiKey] = useState("");
  const [copiedKey, setCopiedKey] = useState(false);

  const { data: indexData } = useSWR(
    "/api/index",
    (url: string) => fetch(url).then((r) => r.json()),
    {
      refreshInterval: 0,
    },
  );
  const indexedRun =
    indexData?.run?.status === "completed" ? indexData.run : null;

  const [newServerModalOpen, setNewServerModalOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [customEmbeddingModalOpen, setCustomEmbeddingModalOpen] =
    useState(false);
  const [customChatModalOpen, setCustomChatModalOpen] = useState(false);
  
  const [isOtherEmbedding, setIsOtherEmbedding] = useState(false);
  const [isOtherChat, setIsOtherChat] = useState(false);

  useEffect(() => {
    if (data?.config) {
      setForm({
        ...data.config,
        chatProvider: data.config.chatProvider || data.config.embeddingProvider,
        chatApiKey: data.config.chatApiKey || data.config.embeddingApiKey,
      });
    }
  }, [data]);

  useEffect(() => {
    const saved = localStorage.getItem("rag_server_api_key");
    if (saved) setServerApiKey(saved);
  }, []);

  const dirty = JSON.stringify(form) !== JSON.stringify(data?.config ?? {});
  const needsReindex =
    data?.config &&
    (form.vectorStore !== data.config.vectorStore ||
      form.embeddingModelId !== data.config.embeddingModelId);

  async function handleSave() {
    if (!data?.config) return;

    let hasError = false;
    const newErrors: Record<string, string> = {};

    if (!form.embeddingProvider) {
      newErrors.embeddingProvider = "Required";
      hasError = true;
    }
    if (!form.embeddingApiKey) {
      newErrors.embeddingApiKey = "Required";
      hasError = true;
    }
    if (!form.chatProvider) {
      newErrors.chatProvider = "Required";
      hasError = true;
    }
    if (!form.chatApiKey) {
      newErrors.chatApiKey = "Required";
      hasError = true;
    }

    if (form.vectorStore) {
      const store = getVectorStore(form.vectorStore);
      if (store) {
        const storeErrs = validateStoreConfig(
          store,
          form.storeConfig || {},
          form.indexType || "hybrid",
        );
        if (Object.keys(storeErrs).length > 0) {
          Object.assign(newErrors, storeErrs);
          hasError = true;
        }
      }
    }

    setErrors(newErrors);

    if (hasError) {
      toast.error("Please fill in all required fields", { duration: Number.POSITIVE_INFINITY });
      return;
    }

    setSaving(true);
    try {
      const verifyRes = await fetch("/api/config/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          embeddingProvider: form.embeddingProvider,
          embeddingApiKey: form.embeddingApiKey,
          embeddingModelId: form.embeddingModelId,
          customEmbeddings: form.customEmbeddings,
          chatProvider: form.chatProvider,
          chatApiKey: form.chatApiKey,
          chatModelId: form.chatModelId,
          customChatModels: form.customChatModels,
        }),
      });

      if (!verifyRes.ok) {
        const err = await verifyRes.json();
        throw new Error(err.error || "Verification failed");
      }

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
      toast.success("Settings saved", { duration: Number.POSITIVE_INFINITY });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save", { duration: Number.POSITIVE_INFINITY });
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

  const clearError = (key: string) => {
    if (errors[key]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const setStoreValue = (key: string, value: string) => {
    setForm((f) => ({ ...f, storeConfig: { ...f.storeConfig, [key]: value } }));
    clearError(key);
  };

  function handleServerApiKeyChange(v: string) {
    setServerApiKey(v);
    localStorage.setItem("rag_server_api_key", v);
  }

  function handleStructuralChangeBlock() {
    toast("Cannot modify configuration", {
      description:
        "You cannot change this in the current project because it already has an index. You must initiate a new project.",
      duration: Number.POSITIVE_INFINITY,
      action: {
        label: "New Project",
        onClick: () => {
          setNewServerModalOpen(true);
        },
      },
    });
  }

  function generateApiKey() {
    const key =
      "sk-" +
      Array.from(crypto.getRandomValues(new Uint8Array(24)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    handleServerApiKeyChange(key);
    toast.success("API key generated", { duration: Number.POSITIVE_INFINITY });
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

      <ServerFormDialog
        mode="create"
        open={newServerModalOpen}
        onOpenChange={setNewServerModalOpen}
      />

      <CustomModelModal
        type="embedding"
        open={customEmbeddingModalOpen}
        onOpenChange={setCustomEmbeddingModalOpen}
        onSave={(cfg) => {
          setForm({
            ...form,
            embeddingProvider: "custom",
            embeddingModelId: `custom:${cfg.modelName}`,
            customEmbeddings: [cfg],
          });
          clearError("embeddingProvider");
        }}
      />
      <CustomModelModal
        type="chat"
        open={customChatModalOpen}
        onOpenChange={setCustomChatModalOpen}
        onSave={(cfg) => {
          setForm({
            ...form,
            chatProvider: "custom",
            chatModelId: `custom:${cfg.modelName}`,
            customChatModels: [cfg],
          });
          clearError("chatProvider");
        }}
      />

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
                <div className="flex gap-2">
                  <Select
                    value={form.embeddingProvider ?? "openai"}
                    onValueChange={(v: any) => {
                      if (
                        indexedRun &&
                        data?.config &&
                        v !== data.config.embeddingProvider
                      ) {
                        handleStructuralChangeBlock();
                        return;
                      }
                      setForm({
                        ...form,
                        embeddingProvider: v,
                        embeddingModelId: "", // clear so backend uses new provider's default
                        chatProvider:
                          !form.chatProvider ||
                          form.chatProvider === form.embeddingProvider
                            ? v
                            : form.chatProvider,
                        chatModelId:
                          !form.chatProvider ||
                          form.chatProvider === form.embeddingProvider
                            ? "" // clear chat model id too if we are updating chatProvider
                            : form.chatModelId,
                      });
                      clearError("embeddingProvider");
                      clearError("chatProvider");
                    }}
                  >
                    <SelectTrigger
                      className={cn(
                        "w-full",
                        errors.embeddingProvider && "border-destructive",
                      )}
                    >
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
                      {PROVIDER_LIST.filter(
                        (key) => (EMBEDDING_BY_PROVIDER[key] && EMBEDDING_BY_PROVIDER[key].length > 0) || key === "vercel_ai_gateway"
                      ).map((key) => {
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
                                {key === "vercel_ai_gateway" &&
                                  " (Recommended)"}
                              </span>
                            </div>
                          </SelectItem>
                        );
                      })}
                      {form.customEmbeddings?.map((cfg) => (
                        <SelectItem
                          key={`custom:${cfg.modelName}`}
                          value="custom"
                        >
                          <div className="flex items-center gap-2">
                            <ProviderIcon
                              src={PROVIDER_META.custom.iconSrc}
                              alt="Custom"
                              pillBg={PROVIDER_META.custom.pillBg}
                              size={16}
                            />
                            <span>{cfg.modelName} (Custom)</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="icon"
                    type="button"
                    onClick={() => setCustomEmbeddingModalOpen(true)}
                    className="shrink-0 h-9 w-9"
                  >
                    <Plus className="size-4" />
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5 mt-4">
                <Label className="text-xs">Model</Label>
                <div className="flex flex-col gap-2">
                  <Select
                    value={isOtherEmbedding ? "other" : (form.embeddingModelId || "")}
                    onValueChange={(v: string | null) => {
                      if (!v) return;
                      if (v === "other") {
                        setIsOtherEmbedding(true);
                        return;
                      }
                      setIsOtherEmbedding(false);
                      if (
                        indexedRun &&
                        data?.config &&
                        v !== data.config.embeddingModelId
                      ) {
                        handleStructuralChangeBlock();
                        return;
                      }
                      setForm({ ...form, embeddingModelId: v });
                      clearError("embeddingModelId");
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <span>{form.embeddingModelId || "Default"}</span>
                    </SelectTrigger>
                    <SelectContent className="max-h-[320px]">
                      {Object.entries(EMBEDDING_BY_PROVIDER)
                        .filter(
                          ([provider]) =>
                            form.embeddingProvider === "vercel_ai_gateway" ||
                            provider === form.embeddingProvider ||
                            provider === "deepseek",
                        )
                        .map(([provider, models]) => {
                          const meta =
                            PROVIDER_META[
                              provider as keyof typeof PROVIDER_META
                            ];
                          return (
                            <SelectGroup key={provider}>
                              <SelectLabel className="flex items-center gap-2 py-1.5">
                                {meta && (
                                  <ProviderIcon
                                    src={meta.iconSrc}
                                    alt={meta.label}
                                    pillBg={meta.pillBg}
                                    size={18}
                                  />
                                )}
                                <span className="font-medium">
                                  {meta?.label ?? provider}
                                </span>
                              </SelectLabel>
                              {models.map((m) => (
                                <SelectItem
                                  key={m.id}
                                  value={m.id}
                                  className="pl-8"
                                >
                                  <span className="flex items-center gap-2">
                                    <span>{m.label}</span>
                                    <span className="text-[10px] text-muted-foreground font-mono">
                                      {m.dimensions}d
                                    </span>
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          );
                        })}
                      {/* Custom models */}
                      {(form.customEmbeddings ?? []).length > 0 && (
                        <SelectGroup>
                          <SelectLabel className="flex items-center gap-2 py-1.5">
                            <ProviderIcon
                              src={PROVIDER_META.custom.iconSrc}
                              alt="Custom"
                              pillBg={PROVIDER_META.custom.pillBg}
                              size={18}
                            />
                            <span className="font-medium">Custom</span>
                          </SelectLabel>
                          {(form.customEmbeddings ?? []).map((m) => (
                            <SelectItem
                              key={`custom:${m.modelName}`}
                              value={`custom:${m.modelName}`}
                              className="pl-8"
                            >
                              <span className="flex items-center gap-2">
                                <span>{m.modelName}</span>
                                <span className="text-[10px] text-muted-foreground font-mono">
                                  {m.dimensions}d
                                </span>
                              </span>
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      )}
                      <SelectGroup>
                        <SelectItem value="other" className="pl-8">
                          <span className="flex items-center gap-2">
                            <span>Other...</span>
                          </span>
                        </SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  {isOtherEmbedding && (
                    <div className="w-full mt-2">
                      <Input
                        placeholder="Enter custom model ID"
                        value={form.embeddingModelId || ""}
                        onChange={(e) => setForm({ ...form, embeddingModelId: e.target.value })}
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">API Key</Label>
                <div className="relative">
                  <Input
                    type={showEmbeddingKey ? "text" : "password"}
                    value={form.embeddingApiKey || ""}
                    onChange={(e) => {
                      setForm({
                        ...form,
                        embeddingApiKey: e.target.value,
                        chatApiKey:
                          !form.chatApiKey ||
                          form.chatApiKey === form.embeddingApiKey
                            ? e.target.value
                            : form.chatApiKey,
                      });
                      clearError("embeddingApiKey");
                      clearError("chatApiKey");
                    }}
                    placeholder="sk-..."
                    className={cn(
                      "pr-10",
                      errors.embeddingApiKey && "border-destructive",
                    )}
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
                  value={form.vectorStore || ""}
                  onValueChange={(v) => {
                    if (
                      indexedRun &&
                      data?.config &&
                      v !== data.config.vectorStore
                    ) {
                      handleStructuralChangeBlock();
                      return;
                    }
                    selectStore(v as VectorStoreId);
                  }}
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
                    errors={errors}
                    onChange={setStoreValue}
                    indexType={form.indexType || "hybrid"}
                  />
                </div>
              )}
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
                <div className="flex gap-2">
                  <Select
                    value={
                      form.chatProvider || form.embeddingProvider || "openai"
                    }
                    onValueChange={(v: any) => {
                      setForm({ ...form, chatProvider: v, chatModelId: "" });
                      clearError("chatProvider");
                    }}
                  >
                    <SelectTrigger
                      className={cn(
                        "w-full",
                        errors.chatProvider && "border-destructive",
                      )}
                    >
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
                      {form.customChatModels?.map((cfg) => (
                        <SelectItem
                          key={`custom:${cfg.modelName}`}
                          value="custom"
                        >
                          <div className="flex items-center gap-2">
                            <ProviderIcon
                              src={PROVIDER_META.custom.iconSrc}
                              alt="Custom"
                              pillBg={PROVIDER_META.custom.pillBg}
                              size={16}
                            />
                            <span>{cfg.modelName} (Custom)</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="icon"
                    type="button"
                    onClick={() => setCustomChatModalOpen(true)}
                    className="shrink-0 h-9 w-9"
                  >
                    <Plus className="size-4" />
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5 mt-4">
                <Label className="text-xs">Model</Label>
                <div className="flex flex-col gap-2">
                  <Select
                    value={isOtherChat ? "other" : (form.chatModelId || "")}
                    onValueChange={(v: string | null) => {
                      if (!v) return;
                      if (v === "other") {
                        setIsOtherChat(true);
                        return;
                      }
                      setIsOtherChat(false);
                      setForm({ ...form, chatModelId: v });
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <span className="truncate">{form.chatModelId || "Default"}</span>
                    </SelectTrigger>
                    <SelectContent className="max-h-[320px]">
                      {chatStatus?.availableModels ? (
                        <SelectGroup>
                          {chatStatus.availableModels.map((m: any) => (
                            <SelectItem
                              key={m.id}
                              value={m.id}
                            >
                              <span className="flex items-center gap-2">
                                <span>{m.label}</span>
                              </span>
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ) : (
                        <div className="p-2 text-sm text-muted-foreground">Loading models...</div>
                      )}
                      {/* Custom models */}
                      {(form.customChatModels ?? []).length > 0 && (
                        <SelectGroup>
                          <SelectLabel className="flex items-center gap-2 py-1.5">
                            <ProviderIcon
                              src={PROVIDER_META.custom.iconSrc}
                              alt="Custom"
                              pillBg={PROVIDER_META.custom.pillBg}
                              size={18}
                            />
                            <span className="font-medium">Custom</span>
                          </SelectLabel>
                          {(form.customChatModels ?? []).map((m) => (
                            <SelectItem
                              key={`custom:${m.modelName}`}
                              value={`custom:${m.modelName}`}
                              className="pl-8"
                            >
                              <span className="flex items-center gap-2">
                                <span>{m.modelName}</span>
                              </span>
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      )}
                      <SelectGroup>
                        <SelectItem value="other" className="pl-8">
                          <span className="flex items-center gap-2">
                            <span>Other...</span>
                          </span>
                        </SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  {isOtherChat && (
                    <div className="w-full mt-2">
                      <Input
                        placeholder="Enter custom model ID"
                        value={form.chatModelId || ""}
                        onChange={(e) => setForm({ ...form, chatModelId: e.target.value })}
                      />
                    </div>
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">API Key</Label>
                <div className="relative">
                  <Input
                    type={showChatKey ? "text" : "password"}
                    value={form.chatApiKey || ""}
                    onChange={(e) => {
                      setForm({ ...form, chatApiKey: e.target.value });
                      clearError("chatApiKey");
                    }}
                    placeholder="sk-..."
                    className={cn(
                      "pr-10",
                      errors.chatApiKey && "border-destructive",
                    )}
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
