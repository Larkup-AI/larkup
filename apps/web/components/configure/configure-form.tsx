"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import useSWR from "swr";
import {
  ChevronDown,
  Cloud,
  Loader2,
  Save,
  Sparkles,
  Database,
  Plus,
  Eye,
  EyeOff,
  Trash2,
  AlertCircle,
  ExternalLink,
  CheckCircle2,
  Download,
  Clock,
  Settings,
} from "lucide-react";
import { GenericAlert } from "@/components/alerts/generic-alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectGroup,
  SelectLabel,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  DEFAULT_CONFIG,
  type IndexType,
  type RagConfig,
  type VectorStoreId,
  type EmbeddingProvider,
  type CustomModelConfig,
} from "@larkup/core/types";
import {
  EMBEDDING_MODELS,
  getEmbeddingModel,
} from "@larkup/core/embeddings/registry";
import {
  getVectorStore,
  validateStoreConfig,
  VECTOR_STORE_LIST,
} from "@larkup/vector-stores/registry";
import { StoreFields } from "@/components/configure/store-fields";
import { useRouter } from "next/navigation";
import { PROVIDER_META, ProviderIcon } from "@/components/ui/provider-icon";
import { CustomModelModal } from "./custom-model-modal";

const fetcher = (url: string) =>
  fetch(url).then((r) => r.json() as Promise<{ config: RagConfig }>);

// ── Index types ───────────────────────────────────────────────────────────────

const INDEX_TYPES: { value: IndexType; label: string; hint: string }[] = [
  { value: "lexical", label: "Lexical", hint: "Keyword / BM25 matching" },
  { value: "semantic", label: "Semantic", hint: "Pure vector similarity" },
  { value: "hybrid", label: "Hybrid", hint: "Lexical + semantic, reranked" },
];

// ── Vector-store branding (real icons from /icons/) ───────────────────────────

type StoreMeta = {
  iconSrc: string;
  pillBg: string;
};

const STORE_META: Record<VectorStoreId, StoreMeta> = {
  lancedb: {
    iconSrc: "/icons/lancedb2.png",
    pillBg: "bg-yellow-50 dark:bg-yellow-950/40",
  },
  pinecone: {
    iconSrc: "/icons/pinecone.png",
    pillBg: "bg-green-50 dark:bg-green-950/40",
  },
  weaviate: {
    iconSrc: "/icons/weaviate.webp",
    pillBg: "bg-teal-50 dark:bg-teal-950/40",
  },
  qdrant: {
    iconSrc: "/icons/qdrant.svg",
    pillBg: "bg-red-50 dark:bg-red-950/40",
  },
  chroma: {
    iconSrc: "/icons/chroma.png",
    pillBg: "bg-purple-50 dark:bg-purple-950/40",
  },
  pgvector: {
    iconSrc: "/icons/pgvector2.png",
    pillBg: "bg-blue-50 dark:bg-blue-950/40",
  },
  supabase: {
    iconSrc: "/icons/supabase.png",
    pillBg: "bg-emerald-50 dark:bg-emerald-950/40",
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

// Group embedding models by provider for the grouped select
const EMBEDDING_BY_PROVIDER = EMBEDDING_MODELS.reduce<
  Record<string, typeof EMBEDDING_MODELS>
>((acc, m) => {
  (acc[m.provider] ??= []).push(m);
  return acc;
}, {});

// ── Main component ────────────────────────────────────────────────────────────

const indexFetcher = (url: string) => fetch(url).then((r) => r.json());

// Expose dirty state + save trigger so the configure page can place the button in the header
export type ConfigureFormHandle = {
  dirty: boolean;
  saving: boolean;
  requestSave: () => void;
};

export function ConfigureForm({
  onHandleReady,
}: {
  onHandleReady?: (handle: ConfigureFormHandle) => void;
}) {
  const router = useRouter();
  const { data, isLoading, mutate } = useSWR("/api/config", fetcher);
  const { data: indexData } = useSWR("/api/index", indexFetcher, {
    refreshInterval: 0,
  });
  // Fetch install status for optional vector stores
  const { data: storeStatusData, mutate: mutateStoreStatus } = useSWR(
    "/api/vector-stores/status",
    (url: string) => fetch(url).then((r) => r.json()),
    { refreshInterval: 0 },
  );
  const [form, setForm] = useState<RagConfig>(DEFAULT_CONFIG);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [customModalOpen, setCustomModalOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  // Confirmation summary dialog before saving
  const [saveConfirmOpen, setSaveConfirmOpen] = useState(false);
  // Unsaved-changes navigation blocker
  const [navBlockOpen, setNavBlockOpen] = useState(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  // Blocking alert dialogs when index already exists
  const [storeBlockAlertOpen, setStoreBlockAlertOpen] = useState(false);
  const [modelBlockAlertOpen, setModelBlockAlertOpen] = useState(false);
  const [apiKeyModalOpen, setApiKeyModalOpen] = useState(false);
  const [testingKey, setTestingKey] = useState(false);
  const [showProviderApiKey, setShowProviderApiKey] = useState(false);

  // Is the currently selected store actually installed (for installable stores)?
  const isStoreInstalled = useCallback(
    (storeId: VectorStoreId) => {
      const desc = getVectorStore(storeId);
      if (desc.installStatus === "installed") return true;
      if (desc.installStatus === "coming-soon") return false;
      // installable — check runtime status
      return storeStatusData?.stores?.[storeId]?.installed === true;
    },
    [storeStatusData],
  );

  const currentStoreInstalled = isStoreInstalled(form.vectorStore);
  // Cache storeConfig per store id so switching A→B→A restores A's values.
  const storeConfigCache = useRef<Record<string, Record<string, string>>>({});

  // Hydrate local form from the persisted config once it loads.
  useEffect(() => {
    if (data?.config && !hydrated) {
      setForm(data.config);
      storeConfigCache.current[data.config.vectorStore] =
        data.config.storeConfig;
      setHydrated(true);
    }
  }, [data, hydrated]);

  const store = getVectorStore(form.vectorStore);
  // Resolve the active custom model from the array when id starts with "custom:"
  const activeCustomModel = form.embeddingModelId.startsWith("custom:")
    ? (form.customEmbeddings ?? []).find(
        (m) => m.modelName === form.embeddingModelId.slice("custom:".length),
      )
    : undefined;
  const embeddingModel = activeCustomModel
    ? null
    : getEmbeddingModel(form.embeddingModelId);
  const embeddingMeta = embeddingModel
    ? PROVIDER_META[embeddingModel.provider as EmbeddingProvider]
    : null;
  const storeMeta = STORE_META[form.vectorStore];
  const indexTypeMeta = INDEX_TYPES.find((t) => t.value === form.indexType);

  const set = <K extends keyof RagConfig>(key: K, value: RagConfig[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const setStoreValue = (key: string, value: string) => {
    setForm((f) => ({ ...f, storeConfig: { ...f.storeConfig, [key]: value } }));
    setErrors((e) => {
      const next = { ...e };
      delete next[key];
      return next;
    });
  };

  // Whether a completed index already exists
  const indexedRun =
    indexData?.run?.status === "completed" ? indexData.run : null;
  const indexedDimensions: number | null = indexedRun?.dimensions ?? null;
  const indexedVectorStore: VectorStoreId | null =
    indexedRun?.vectorStore ?? null;

  const selectStore = (id: VectorStoreId) => {
    if (id === form.vectorStore) return;
    // Block "coming soon" stores
    const desc = getVectorStore(id);
    if (desc.installStatus === "coming-soon") {
      toast.info(`${desc.label} support is coming soon!`);
      return;
    }
    // Block if a completed index exists with a different vector store
    if (indexedVectorStore && id !== indexedVectorStore) {
      setStoreBlockAlertOpen(true);
      return;
    }
    storeConfigCache.current[form.vectorStore] = form.storeConfig;
    const next = getVectorStore(id);
    const cached = storeConfigCache.current[id];
    if (cached) {
      setForm((f) => ({ ...f, vectorStore: id, storeConfig: cached }));
    } else {
      const seeded: Record<string, string> = {};
      for (const field of next.fields) {
        if (field.defaultValue) seeded[field.key] = field.defaultValue;
      }
      setForm((f) => ({ ...f, vectorStore: id, storeConfig: seeded }));
    }
    setErrors({});
  };

  const handleInstallStore = async (storeId: VectorStoreId) => {
    setInstalling(true);
    try {
      const res = await fetch("/api/vector-stores/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error ?? "Installation failed");
      }
      toast.success(
        `${getVectorStore(storeId).label} installed successfully!`,
        {
          description: `The ${json.package} package has been added to your project.`,
        },
      );
      // Refresh install status optimistically so the UI instantly hides the install card
      await mutateStoreStatus(
        (current: any) => ({
          ...current,
          stores: {
            ...(current?.stores || {}),
            [storeId]: { installed: true },
          },
        }),
        { revalidate: true },
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Installation failed");
    } finally {
      setInstalling(false);
    }
  };

  // Returns true if the given model ID would have different dimensions than the indexed run
  function wouldBreakDimensions(newModelId: string): boolean {
    if (!indexedDimensions) return false;
    if (newModelId.startsWith("custom:")) {
      const name = newModelId.slice("custom:".length);
      const custom = (form.customEmbeddings ?? []).find(
        (m) => m.modelName === name,
      );
      if (!custom) return false;
      return custom.dimensions !== indexedDimensions;
    }
    const model = getEmbeddingModel(newModelId);
    if (!model) return false;
    return model.dimensions !== indexedDimensions;
  }

  const handleEmbeddingModelChange = (v: string) => {
    if (wouldBreakDimensions(v)) {
      setModelBlockAlertOpen(true);
      return;
    }
    set("embeddingModelId", v);
    if (!form.embeddingApiKey) {
      toast.error("API Key Required", {
        description:
          "Please set an API key for this provider. Recommended: Vercel AI Gateway Key.",
      });
      setApiKeyModalOpen(true);
    }
  };

  const dirty = useMemo(
    () => hydrated && JSON.stringify(form) !== JSON.stringify(data?.config),
    [form, data, hydrated],
  );

  // Unsaved changes: block browser refresh / close
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // Intercept Next.js App Router client-side link clicks when there are unsaved changes
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (!dirtyRef.current) return;
      const anchor = (e.target as Element)?.closest("a[href]");
      if (!anchor) return;
      const href = anchor.getAttribute("href") ?? "";
      // Only intercept same-origin relative navigation (not # links or external)
      if (!href || href.startsWith("#") || href.startsWith("http")) return;
      // Skip if it's already the configure page
      if (href === "/configure" || href === "/") return;
      e.preventDefault();
      e.stopPropagation();
      setPendingHref(href);
      setNavBlockOpen(true);
    };
    document.addEventListener("click", handleClick, { capture: true });
    return () =>
      document.removeEventListener("click", handleClick, { capture: true });
  }, []);

  // Expose handle to parent
  useEffect(() => {
    if (onHandleReady) {
      onHandleReady({
        dirty,
        saving,
        requestSave: () => setSaveConfirmOpen(true),
      });
    }
  }, [dirty, saving, onHandleReady]);

  async function performSave() {
    const fieldErrors = validateStoreConfig(
      store,
      form.storeConfig,
      form.indexType,
    );
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      toast.error("Please complete the required vector store fields.");
      return;
    }
    setSaving(true);
    try {
      const testRes = await fetch("/api/config/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const testJson = await testRes.json();
      if (!testRes.ok) {
        if (testJson.fieldErrors) setErrors(testJson.fieldErrors);
        throw new Error(
          `Connection test failed: ${testJson.error ?? "Invalid credentials"}`,
        );
      }
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) {
        if (json.fieldErrors) setErrors(json.fieldErrors);
        throw new Error(json.error ?? "Failed to save configuration");
      }
      await mutate(json, { revalidate: false });
      setForm(json.config);
      toast.success("Configuration saved", {
        description: "Written to .larkup/config.json",
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    const fieldErrors = validateStoreConfig(
      store,
      form.storeConfig,
      form.indexType,
    );
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      toast.error("Please complete the required vector store fields.");
      return;
    }
    setTesting(true);
    try {
      const res = await fetch("/api/config/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) {
        if (json.fieldErrors) setErrors(json.fieldErrors);
        throw new Error(json.error ?? "Connection failed");
      }
      toast.success("Connection successful", {
        description: "Credentials and settings are valid.",
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setTesting(false);
    }
  }

  if (isLoading && !hydrated) {
    return (
      <div className="flex items-center gap-2 px-6 py-16 text-muted-foreground md:px-8">
        <Loader2 className="size-4 animate-spin" />
        <span className="text-sm">Loading configuration…</span>
      </div>
    );
  }

  // Build summary rows for confirm dialog
  const summaryItems = [
    { label: "Project", value: form.projectName },
    {
      label: "Embedding model",
      value:
        activeCustomModel?.modelName ??
        embeddingModel?.label ??
        form.embeddingModelId,
    },
    {
      label: "Provider",
      value: activeCustomModel
        ? "Custom (OpenAI-compatible)"
        : (embeddingMeta?.label ?? embeddingModel?.provider ?? "—"),
    },
    {
      label: "Dimensions",
      value: String(
        activeCustomModel?.dimensions ?? embeddingModel?.dimensions ?? "—",
      ),
      mono: true,
    },
    { label: "Index type", value: indexTypeMeta?.label ?? form.indexType },
    { label: "Vector store", value: store.label },
    {
      label: "Chunk size / overlap",
      value: `${form.chunking.chunkSize} / ${form.chunking.chunkOverlap} tokens`,
      mono: true,
    },
    { label: "Top-K", value: String(form.topK), mono: true },
  ];

  return (
    <div className="px-6 py-6 md:px-8">
      {/* ── Cards: first two side-by-side, last card full-width below ── */}
      <div className="mx-auto  space-y-5">
        {/* Row 1: Project + Embedding side-by-side */}
        <div className="grid gap-5 lg:grid-cols-2">
          {/* Project */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Project</CardTitle>
              <CardDescription className="text-xs">
                Identifies this pipeline and names the generated server.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="projectName">Project name</Label>
                <Input
                  id="projectName"
                  value={form.projectName}
                  spellCheck={false}
                  onChange={(e) => set("projectName", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="topK">Default top-K</Label>
                <Input
                  id="topK"
                  type="number"
                  min={1}
                  max={50}
                  value={form.topK}
                  onChange={(e) =>
                    set("topK", Math.max(1, Number(e.target.value) || 1))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Documents returned per query.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Embedding model */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between text-base">
                <div className="flex items-center gap-2">
                  <Sparkles className="size-4 text-primary" />
                  Embedding model
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setApiKeyModalOpen(true)}
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                >
                  <Settings className="size-4" />
                </Button>
              </CardTitle>
              <CardDescription className="text-xs">
                Used to embed chunks at index time and queries at runtime.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Model selector */}
              <div className="space-y-1.5">
                <Label>Model</Label>
                <div className="flex gap-2 items-start">
                  <Select
                    value={form.embeddingModelId}
                    onValueChange={(v) =>
                      handleEmbeddingModelChange((v as string) ?? "")
                    }
                  >
                    <SelectTrigger
                      className="w-full flex-1"
                      onPointerDown={(e) => {
                        if (!form.embeddingApiKey) {
                          e.preventDefault();
                          toast.info("API Key Required", {
                            description:
                              "Please set an API key first. Recommended: Vercel AI Gateway Key.",
                          });
                          setApiKeyModalOpen(true);
                        }
                      }}
                    >
                      {activeCustomModel ? (
                        <span className="flex items-center gap-2.5">
                          <ProviderIcon
                            src={PROVIDER_META.custom.iconSrc}
                            alt="Custom"
                            pillBg={PROVIDER_META.custom.pillBg}
                            size={20}
                          />
                          <span className="flex flex-col items-start leading-none">
                            <span className="font-medium text-sm">
                              {activeCustomModel.modelName}
                            </span>
                          </span>
                        </span>
                      ) : embeddingModel && embeddingMeta ? (
                        <span className="flex items-center gap-2.5">
                          <ProviderIcon
                            src={embeddingMeta.iconSrc}
                            alt={embeddingMeta.label}
                            pillBg={embeddingMeta.pillBg}
                            size={20}
                          />
                          <span className="flex flex-col items-start leading-none">
                            <span className="font-medium text-sm ">
                              {embeddingModel.label}
                            </span>
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          Select a model…
                        </span>
                      )}
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
                      {/* Custom models group — one entry per saved custom model */}
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
                    </SelectContent>
                  </Select>
                  <TooltipProvider delay={0}>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => setCustomModalOpen(true)}
                            type="button"
                          >
                            <Plus className="size-4" />
                          </Button>
                        }
                      />
                      <TooltipContent>
                        <p>Add custom embedding model</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  {/* Trash button — only visible when a custom model is selected */}
                  {activeCustomModel && (
                    <TooltipProvider delay={0}>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              variant="outline"
                              size="icon"
                              type="button"
                              onClick={() => setDeleteConfirmOpen(true)}
                              className="text-destructive hover:text-destructive hover:bg-destructive/10 hover:border-destructive/50"
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          }
                        />
                        <TooltipContent>
                          <p>Delete "{activeCustomModel.modelName}"</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>

                {/* Model info badges */}
                {activeCustomModel ? (
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant="secondary" className="font-mono">
                      {activeCustomModel.dimensions} dims
                    </Badge>
                    <Badge variant="outline" className="font-mono">
                      OpenAI Compatible
                    </Badge>
                    <span className="text-muted-foreground">
                      Custom configuration
                    </span>
                  </div>
                ) : embeddingModel ? (
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant="secondary" className="font-mono">
                      {embeddingModel.dimensions} dims
                    </Badge>
                    <Badge variant="outline" className="font-mono">
                      {embeddingModel.maxInputTokens.toLocaleString()} max
                      tokens
                    </Badge>
                    <span className="text-muted-foreground">
                      {embeddingModel.description}
                    </span>
                  </div>
                ) : null}
              </div>

              {/* Advanced chunking */}
              <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                <CollapsibleTrigger className="-ml-2 inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                  <ChevronDown
                    className={cn(
                      "size-4 transition-transform duration-200",
                      advancedOpen && "rotate-180",
                    )}
                  />
                  Advanced chunking
                </CollapsibleTrigger>
                <CollapsibleContent className="overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:slide-out-to-top-1 data-[state=open]:slide-in-from-top-1 pt-3">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="chunkSize">Chunk size</Label>
                      <Input
                        id="chunkSize"
                        type="number"
                        min={64}
                        value={form.chunking.chunkSize}
                        onChange={(e) =>
                          set("chunking", {
                            ...form.chunking,
                            chunkSize: Number(e.target.value) || 0,
                          })
                        }
                      />
                      <p className="text-xs text-muted-foreground">tokens</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="chunkOverlap">Overlap</Label>
                      <Input
                        id="chunkOverlap"
                        type="number"
                        min={0}
                        value={form.chunking.chunkOverlap}
                        onChange={(e) =>
                          set("chunking", {
                            ...form.chunking,
                            chunkOverlap: Number(e.target.value) || 0,
                          })
                        }
                      />
                      <p className="text-xs text-muted-foreground">tokens</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="strategy">Strategy</Label>
                      <Select
                        value={form.chunking.strategy}
                        onValueChange={(v) =>
                          set("chunking", {
                            ...form.chunking,
                            strategy: v as RagConfig["chunking"]["strategy"],
                          })
                        }
                      >
                        <SelectTrigger id="strategy" className="w-full">
                          <span>{form.chunking.strategy}</span>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="recursive">Recursive</SelectItem>
                          <SelectItem value="sentence">Sentence</SelectItem>
                          <SelectItem value="fixed">Fixed</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </CardContent>
          </Card>
        </div>

        {/* Row 2: Indexing & Vector Store — full width */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Database className="size-4 text-primary" />
              Indexing &amp; Vector store
            </CardTitle>
            <CardDescription className="text-xs">
              Choose how documents are matched at retrieval time and where
              vectors are stored.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Side-by-side row: index type select + vector store select */}
            <div className="grid gap-4 sm:grid-cols-2">
              {/* Index type */}
              <div className="space-y-2">
                <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Index type
                </Label>
                <Select
                  value={form.indexType}
                  onValueChange={(v) => set("indexType", v as IndexType)}
                >
                  <SelectTrigger className="w-full">
                    {indexTypeMeta ? (
                      <span className="flex flex-col items-start leading-none">
                        <span className="font-medium text-sm">
                          {indexTypeMeta.label}
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        Select index type…
                      </span>
                    )}
                  </SelectTrigger>
                  <SelectContent>
                    {INDEX_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        <span className="flex flex-col">
                          <span className="font-medium">{t.label}</span>
                          <span className="text-[11px] text-muted-foreground">
                            {t.hint}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Vector store */}
              <div className="space-y-2">
                <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Vector store
                </Label>
                <Select
                  value={form.vectorStore}
                  onValueChange={(v) => selectStore(v as VectorStoreId)}
                >
                  <SelectTrigger className="w-full">
                    {storeMeta ? (
                      <span className="flex items-center gap-2.5">
                        <ProviderIcon
                          src={storeMeta.iconSrc}
                          alt={store.label}
                          pillBg={storeMeta.pillBg}
                          size={20}
                        />
                        <span className="flex flex-col items-start leading-none">
                          <span className="font-medium text-sm">
                            {store.label}
                          </span>
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
                      const isInstallable = s.installStatus === "installable";
                      const installed = isStoreInstalled(s.id);
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
                                pillBg={meta.pillBg}
                                size={22}
                              />
                            )}
                            <span className="flex flex-col flex-1 min-w-0">
                              <span className="flex items-center gap-2">
                                <span className="font-medium text-sm leading-tight">
                                  {s.label}
                                </span>
                                {isComingSoon && (
                                  <Badge
                                    variant="outline"
                                    className="h-4 px-1.5 text-[9px] font-medium shrink-0 text-muted-foreground border-muted-foreground/30"
                                  >
                                    <Clock className="size-2.5 mr-0.5" />
                                    Coming Soon
                                  </Badge>
                                )}
                                {isInstallable && !installed && (
                                  <Badge
                                    variant="outline"
                                    className="h-4 px-1.5 text-[9px] font-medium shrink-0 text-amber-600 dark:text-amber-400 border-amber-500/30"
                                  >
                                    <Download className="size-2.5 mr-0.5" />
                                    Not Installed
                                  </Badge>
                                )}
                              </span>
                              <span className="text-[10px] text-muted-foreground leading-tight">
                                {s.description.split(".")[0]}
                              </span>
                            </span>
                          </span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>

                {/* Store badges */}
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className="text-[10px] font-mono uppercase"
                  >
                    {store.runtime}
                  </Badge>
                  {store.docsUrl && (
                    <a
                      href={store.docsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] text-muted-foreground underline-offset-2 hover:underline hover:text-foreground transition-colors"
                    >
                      docs
                    </a>
                  )}
                </div>
              </div>
            </div>

            {/* Store description */}
            <p className="text-xs leading-relaxed text-muted-foreground border-t pt-4">
              {store.description}
            </p>

            {/* Store config fields — or install prompt if not yet installed */}
            {store.installStatus === "installable" && !currentStoreInstalled ? (
              /* ── Install panel for installable stores ─────────────────── */
              <div className="rounded-lg border border-dashed border-amber-500/40 bg-amber-50/50 dark:bg-amber-950/20 p-6 space-y-4 transition-all duration-300">
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-amber-100 dark:bg-amber-900/40 p-2 shrink-0">
                    <Download className="size-5 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">
                      {store.label} is not installed
                    </p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {store.label} is an optional dependency and not included
                      by default. Click <strong>Install</strong> to add the{" "}
                      <code className="text-[11px] font-mono bg-muted px-1 py-0.5 rounded">
                        {Object.keys(store.serverDependencies)[0]}
                      </code>{" "}
                      package to your project.
                    </p>
                    <p className="text-[11px] text-amber-700 dark:text-amber-400/80 leading-relaxed mt-2">
                      ⚠ Install only works in local development. For production
                      deployments, add the package to your dependencies before
                      deploying.
                    </p>
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    onClick={() => handleInstallStore(form.vectorStore)}
                    disabled={installing}
                    className="gap-2"
                  >
                    {installing ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Download className="size-4" />
                    )}
                    {installing ? "Installing…" : `Install ${store.label}`}
                  </Button>
                </div>
              </div>
            ) : store.installStatus === "coming-soon" ? (
              /* ── Coming Soon panel ──────────────────────────────────── */
              <div className="rounded-lg border border-dashed border-muted-foreground/20 bg-muted/20 p-6 space-y-2 transition-all duration-300">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Clock className="size-4" />
                  <p className="text-sm font-medium">Coming Soon</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  {store.label} support is under development. Stay tuned!
                </p>
              </div>
            ) : (
              /* ── Normal config fields ──────────────────────────────── */
              <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-4 transition-all duration-300">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {store.label} configuration
                </p>
                <StoreFields
                  store={store}
                  values={form.storeConfig}
                  errors={errors}
                  onChange={setStoreValue}
                  indexType={form.indexType}
                />
                <div className="flex justify-end pt-1">
                  <Button
                    variant="default"
                    size="sm"
                    onClick={handleTestConnection}
                    disabled={testing}
                  >
                    {testing ? (
                      <Loader2 className="mr-1 size-4 animate-spin" />
                    ) : (
                      <Cloud className="mr-1 size-4" />
                    )}
                    Test Connection
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Last saved timestamp */}
        {data?.config?.updatedAt &&
          data.config.updatedAt !== new Date(0).toISOString() && (
            <p className="text-center text-xs text-muted-foreground pb-2">
              Last saved {new Date(data.config.updatedAt).toLocaleString()}
            </p>
          )}
      </div>

      {/* ── Save confirmation dialog ─────────────────────────────────────── */}
      <Dialog open={saveConfirmOpen} onOpenChange={setSaveConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="size-5 text-primary" />
              Confirm configuration
            </DialogTitle>
            <DialogDescription>
              Review your settings before saving.
            </DialogDescription>
          </DialogHeader>
          <div className="divide-y divide-border rounded-lg border border-border overflow-hidden text-sm">
            {summaryItems.map((item) => (
              <div
                key={item.label}
                className="flex items-center justify-between px-3 py-2 gap-3"
              >
                <span className="text-muted-foreground text-xs">
                  {item.label}
                </span>
                <span
                  className={cn(
                    "font-medium text-right truncate",
                    item.mono && "font-mono text-xs",
                  )}
                >
                  {item.value}
                </span>
              </div>
            ))}
          </div>
          <DialogFooter className="mt-2 gap-2">
            <Button variant="outline" onClick={() => setSaveConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                setSaveConfirmOpen(false);
                await performSave();
              }}
              disabled={saving}
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin mr-2" />
              ) : (
                <Save className="size-4 mr-2" />
              )}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Unsaved changes navigation blocker ──────────────────────────── */}
      <GenericAlert
        open={navBlockOpen}
        onOpenChange={setNavBlockOpen}
        contentClassName="max-w-xl! w-full!"
        icon={<AlertCircle className="size-5 text-amber-500" />}
        title="Unsaved changes"
        description="You have unsaved changes to your configuration. If you leave now, your changes will be lost."
        cancelText="Stay on page"
        actionText="Leave without saving"
        variant="destructive"
        onAction={() => {
          if (pendingHref) router.push(pendingHref);
        }}
      />

      <CustomModelModal
        type="embedding"
        open={customModalOpen}
        onOpenChange={setCustomModalOpen}
        onSave={async (cfg) => {
          // Upsert: replace existing model with same name, or append a new one.
          const existing = form.customEmbeddings ?? [];
          const updatedList = existing.some(
            (m) => m.modelName === cfg.modelName,
          )
            ? existing.map((m) => (m.modelName === cfg.modelName ? cfg : m))
            : [...existing, cfg];

          const nextForm = {
            ...form,
            embeddingModelId: `custom:${cfg.modelName}`,
            customEmbeddings: updatedList,
          };
          setForm(nextForm);

          // Auto-save: attempt to persist immediately.
          const storeToSave = getVectorStore(nextForm.vectorStore);
          const fieldErrors = validateStoreConfig(
            storeToSave,
            nextForm.storeConfig,
            nextForm.indexType,
          );

          if (Object.keys(fieldErrors).length === 0) {
            setSaving(true);
            try {
              const res = await fetch("/api/config", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(nextForm),
              });
              if (res.ok) {
                const json = await res.json();
                await mutate(json, { revalidate: false });
                setForm(json.config);
                toast.success(`Custom model "${cfg.modelName}" saved`);
                return;
              }
            } catch {
              // fall through to reminder
            } finally {
              setSaving(false);
            }
          }

          toast.info("Custom model added", {
            description: "Click 'Save configuration' to persist your changes.",
          });
        }}
      />

      {/* ── Block: vector store change after index ─────────────────── */}
      <GenericAlert
        open={storeBlockAlertOpen}
        onOpenChange={setStoreBlockAlertOpen}
        icon={<AlertCircle className="size-5 text-destructive" />}
        title="Cannot change vector store"
        description={
          <>
            <span className="block">
              Your index was built with{" "}
              <span className="font-semibold text-foreground">
                {indexedVectorStore
                  ? (getVectorStore(indexedVectorStore)?.label ??
                    indexedVectorStore)
                  : form.vectorStore}
              </span>
              . Switching to a different vector store would make the existing
              index incompatible — vectors are bound to the store they were
              written to.
            </span>
            <span className="block">
              To use a different vector store, go to the{" "}
              <strong className="text-foreground">Index</strong> page and run a
              full re-index with your new settings.
            </span>
          </>
        }
        cancelText="Keep current store"
        actionText={
          <>
            <ExternalLink className="size-4" />
            Re-index from scratch
          </>
        }
        variant="destructive"
        onAction={() => {
          window.location.href = "/index-data";
        }}
      />

      {/* ── Block: embedding model dimension change after index ──────── */}
      <GenericAlert
        open={modelBlockAlertOpen}
        onOpenChange={setModelBlockAlertOpen}
        icon={<AlertCircle className="size-5 text-destructive" />}
        title="Incompatible embedding dimensions"
        description={
          <>
            <span className="block">
              Your index was built with{" "}
              <span className="font-semibold text-foreground">
                {indexedDimensions} dimensions
              </span>
              . The selected model outputs a different vector size, which is
              incompatible with the existing index.
            </span>
            <span className="block">
              ✓ You can freely switch to any model that also produces{" "}
              <span className="font-semibold text-foreground">
                {indexedDimensions}d
              </span>{" "}
              vectors. To use a different dimension size, go to the{" "}
              <strong className="text-foreground">Index</strong> page and run a
              full re-index.
            </span>
          </>
        }
        cancelText="Keep current model"
        actionText={
          <>
            <ExternalLink className="size-4" />
            Re-index from scratch
          </>
        }
        variant="destructive"
        onAction={() => {
          window.location.href = "/index-data";
        }}
      />

      {/* ── Delete custom model confirmation ─────────────────────────── */}
      <GenericAlert
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="Delete custom model?"
        description={
          <>
            This will remove{" "}
            <span className="font-semibold text-foreground">
              &quot;{activeCustomModel?.modelName}&quot;
            </span>{" "}
            from your saved custom models. This action cannot be undone.
          </>
        }
        cancelText="Cancel"
        actionText="Delete"
        variant="destructive"
        onAction={async () => {
          if (!activeCustomModel) return;
          const modelName = activeCustomModel.modelName;
          const updatedList = (form.customEmbeddings ?? []).filter(
            (m) => m.modelName !== modelName,
          );
          const nextId =
            updatedList.length > 0
              ? `custom:${updatedList[0].modelName}`
              : DEFAULT_CONFIG.embeddingModelId;
          const nextForm = {
            ...form,
            embeddingModelId: nextId,
            customEmbeddings: updatedList,
          };
          setForm(nextForm);

          setSaving(true);
          try {
            const res = await fetch("/api/config", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(nextForm),
            });
            if (res.ok) {
              const json = await res.json();
              await mutate(json, { revalidate: false });
              setForm(json.config);
              toast.success(`Custom model "${modelName}" deleted`);
            }
          } catch {
            toast.error("Failed to save after deletion");
          } finally {
            setSaving(false);
          }
        }}
      />

      {/* API Key settings modal */}
      <Dialog open={apiKeyModalOpen} onOpenChange={setApiKeyModalOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Provider Settings</DialogTitle>
            <DialogDescription>
              Configure the active embedding provider and its API key.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>Provider</Label>
              <Select
                value={form.embeddingProvider || "openai"}
                onValueChange={(v) => {
                  set("embeddingProvider", v as string);
                  // Reset model when provider changes (except for vercel_ai_gateway which shows all)
                  if (v !== "vercel_ai_gateway" && v !== "custom") {
                    const firstModel = EMBEDDING_MODELS.find(
                      (m) => m.provider === v,
                    )?.id;
                    if (firstModel) {
                      set("embeddingModelId", firstModel);
                    }
                  }
                }}
              >
                <SelectTrigger className="w-full">
                  <span className="flex items-center gap-2">
                    {PROVIDER_META[
                      form.embeddingProvider as keyof typeof PROVIDER_META
                    ]?.label || form.embeddingProvider}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {[
                    "vercel_ai_gateway",
                    "openai",
                    "deepseek",
                    "google",
                    // "cohere",
                    "voyage",
                    "mistral",
                    "jina",
                    "nomic",
                    "custom",
                  ].map((providerKey) => {
                    const meta =
                      PROVIDER_META[providerKey as keyof typeof PROVIDER_META];
                    if (!meta) return null;
                    return (
                      <SelectItem key={providerKey} value={providerKey}>
                        <div className="flex items-center gap-2">
                          <ProviderIcon
                            src={meta.iconSrc}
                            alt={meta.label}
                            pillBg={meta.pillBg}
                            size={16}
                          />
                          <span>
                            {meta.label}
                            {providerKey === "vercel_ai_gateway" &&
                              " (Recommended)"}
                          </span>
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="apiKey">API Key</Label>
              <div className="relative">
                <Input
                  id="apiKey"
                  type={showProviderApiKey ? "text" : "password"}
                  placeholder="Enter API Key..."
                  value={form.embeddingApiKey || ""}
                  onChange={(e) => set("embeddingApiKey", e.target.value)}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowProviderApiKey(!showProviderApiKey)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
                >
                  {showProviderApiKey ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Recommended: Use the Vercel AI Gateway key for best performance.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              disabled={testingKey}
              onClick={async () => {
                setTestingKey(true);
                try {
                  const res = await fetch("/api/config/test-provider", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      embeddingProvider: form.embeddingProvider,
                      embeddingApiKey: form.embeddingApiKey,
                      embeddingModelId: form.embeddingModelId,
                      customEmbeddings: form.customEmbeddings,
                    }),
                  });
                  const data = await res.json();
                  if (!res.ok)
                    throw new Error(data.error || "Connection failed");

                  toast.success("Settings saved", {
                    description: `Connection verified for ${form.embeddingProvider}.`,
                  });
                  setApiKeyModalOpen(false);
                } catch (err) {
                  toast.error("Invalid API Key", {
                    description:
                      err instanceof Error
                        ? err.message
                        : "Could not connect to provider.",
                  });
                } finally {
                  setTestingKey(false);
                }
              }}
            >
              {testingKey ? (
                <Loader2 className="size-4 animate-spin mr-2" />
              ) : null}
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


