"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  type CustomEmbeddingConfig,
} from "@buddy-rag/core/types";
import {
  EMBEDDING_MODELS,
  getEmbeddingModel,
} from "@buddy-rag/core/embeddings/registry";
import {
  getVectorStore,
  validateStoreConfig,
  VECTOR_STORE_LIST,
} from "@buddy-rag/vector-stores/registry";
import { StoreFields } from "@/components/configure/store-fields";

const fetcher = (url: string) =>
  fetch(url).then((r) => r.json() as Promise<{ config: RagConfig }>);

// ── Index types ───────────────────────────────────────────────────────────────

const INDEX_TYPES: { value: IndexType; label: string; hint: string }[] = [
  { value: "lexical", label: "Lexical", hint: "Keyword / BM25 matching" },
  { value: "semantic", label: "Semantic", hint: "Pure vector similarity" },
  { value: "hybrid", label: "Hybrid", hint: "Lexical + semantic, reranked" },
];

// ── Provider branding (real icons from /icons/) ───────────────────────────────

type ProviderMeta = {
  label: string;
  /** path relative to /public */
  iconSrc: string;
  /** bg tint for the icon pill */
  pillBg: string;
};

const PROVIDER_META: Record<EmbeddingProvider, ProviderMeta> = {
  openai: {
    label: "OpenAI",
    iconSrc: "/icons/openai.svg",
    pillBg: "bg-neutral-100 dark:bg-neutral-800",
  },
  google: {
    label: "Google",
    iconSrc: "/icons/gemini.svg",
    pillBg: "bg-blue-50 dark:bg-blue-950/40",
  },
  cohere: {
    label: "Cohere",
    iconSrc: "/icons/cohere.svg",
    pillBg: "bg-orange-50 dark:bg-orange-950/40",
  },
  voyage: {
    label: "Voyage AI",
    iconSrc: "/icons/voyage-light.png",
    pillBg: "bg-slate-100 dark:bg-slate-800",
  },
  mistral: {
    label: "Mistral",
    iconSrc: "/icons/mistral.svg",
    pillBg: "bg-amber-50 dark:bg-amber-950/40",
  },
  jina: {
    label: "Jina AI",
    iconSrc: "/icons/jina.svg",
    pillBg: "bg-rose-50 dark:bg-rose-950/40",
  },
  nomic: {
    label: "Nomic",
    iconSrc: "/icons/nomic.png",
    pillBg: "bg-teal-50 dark:bg-teal-950/40",
  },
  custom: {
    label: "Custom",
    iconSrc: "/logo.png",
    pillBg: "bg-slate-100 dark:bg-slate-800",
  },
};

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

/** Small square icon pill used in selects and triggers */
function ProviderIcon({
  src,
  alt,
  pillBg,
  size = 20,
}: {
  src: string;
  alt: string;
  pillBg: string;
  size?: number;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded",
        pillBg,
      )}
      style={{ width: size, height: size }}
    >
      <img
        src={src}
        alt={alt}
        width={size - 4}
        height={size - 4}
        className="object-contain"
        style={{ maxWidth: size - 4, maxHeight: size - 4 }}
      />
    </span>
  );
}

// Group embedding models by provider for the grouped select
const EMBEDDING_BY_PROVIDER = EMBEDDING_MODELS.reduce<
  Record<string, typeof EMBEDDING_MODELS>
>((acc, m) => {
  (acc[m.provider] ??= []).push(m);
  return acc;
}, {});

// ── Main component ────────────────────────────────────────────────────────────

const indexFetcher = (url: string) => fetch(url).then((r) => r.json());

export function ConfigureForm() {
  const { data, isLoading, mutate } = useSWR("/api/config", fetcher);
  const { data: indexData } = useSWR("/api/index", indexFetcher, {
    refreshInterval: 0,
  });
  const [form, setForm] = useState<RagConfig>(DEFAULT_CONFIG);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [customModalOpen, setCustomModalOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  // Blocking alert dialogs when index already exists
  const [storeBlockAlertOpen, setStoreBlockAlertOpen] = useState(false);
  const [modelBlockAlertOpen, setModelBlockAlertOpen] = useState(false);
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
  const indexedRun = indexData?.run?.status === "completed" ? indexData.run : null;
  const indexedDimensions: number | null = indexedRun?.dimensions ?? null;
  const indexedVectorStore: VectorStoreId | null = indexedRun?.vectorStore ?? null;

  const selectStore = (id: VectorStoreId) => {
    if (id === form.vectorStore) return;
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
  };

  const dirty = useMemo(
    () => hydrated && JSON.stringify(form) !== JSON.stringify(data?.config),
    [form, data, hydrated],
  );

  async function handleSave() {
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
        description: "Written to .ragtoolkit/config.json",
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

  return (
    <div className="px-6 py-6 md:px-8">
      <div className="grid gap-6 lg:grid-cols-3">
        {/* ── Main column ────────────────────────────────────────────── */}
        <div className="space-y-6 lg:col-span-2">
          {/* Project */}
          <Card>
            <CardHeader>
              <CardTitle>Project</CardTitle>
              <CardDescription>
                Identifies this pipeline and names the generated server.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-2">
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

          {/* ── Embedding model + chunking ─────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="size-4 text-primary" />
                Embedding model
              </CardTitle>
              <CardDescription>
                Used to embed chunks at index time and queries at runtime.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Model selector */}
              <div className="flex gap-2 items-start">
                <Select
                  value={form.embeddingModelId}
                  onValueChange={(v) => handleEmbeddingModelChange((v as string) ?? "")}
                >
                  <SelectTrigger className="w-full flex-1">
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
                    {Object.entries(EMBEDDING_BY_PROVIDER).map(
                      ([provider, models]) => {
                        const meta =
                          PROVIDER_META[provider as EmbeddingProvider];
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
                      },
                    )}
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
                    {embeddingModel.maxInputTokens.toLocaleString()} max tokens
                  </Badge>
                  <span className="text-muted-foreground">
                    {embeddingModel.description}
                  </span>
                </div>
              ) : null}

              {/* Advanced chunking — directly under embedding model */}
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
                  <div className="grid gap-5 sm:grid-cols-3">
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

          {/* ── Indexing & Vector Store ────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="size-4 text-primary" />
                Indexing &amp; Vector store
              </CardTitle>
              <CardDescription>
                Choose how documents are matched at retrieval time and where
                vectors are stored.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Side-by-side row: index type select + vector store select */}
              <div className="grid gap-4 sm:grid-cols-2">
                {/* Index type — select (same height as vector store) */}
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
                          {/* <span className="text-[10px] text-muted-foreground mt-0.5">
                            {indexTypeMeta.hint}
                          </span> */}
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

                {/* Vector store — select with real icons */}
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
                            {/* <span className="text-[10px] text-muted-foreground mt-0.5">
                              {store.runtime === "both"
                                ? "local / cloud"
                                : store.runtime}
                            </span> */}
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
                        return (
                          <SelectItem key={s.id} value={s.id}>
                            <span className="flex items-center gap-2.5">
                              {meta && (
                                <ProviderIcon
                                  src={meta.iconSrc}
                                  alt={s.label}
                                  pillBg={meta.pillBg}
                                  size={22}
                                />
                              )}
                              <span className="flex flex-col">
                                <span className="font-medium text-sm leading-tight">
                                  {s.label}
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

              {/* Store config fields */}
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
                    variant="secondary"
                    size="sm"
                    onClick={handleTestConnection}
                    disabled={testing}
                  >
                    {testing ? (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    ) : (
                      <Cloud className="mr-2 size-4" />
                    )}
                    Test Connection
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── Summary rail ───────────────────────────────────────────── */}
        <div className="lg:col-span-1">
          <div className="lg:sticky lg:top-6 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Summary</CardTitle>
                <CardDescription>
                  This config drives indexing and the generated server.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <SummaryRow label="Project" value={form.projectName} mono />
                <SummaryRow
                  label="Embeddings"
                  value={embeddingModel?.label ?? form.embeddingModelId}
                />
                <SummaryRow
                  label="Provider"
                  value={
                    embeddingMeta?.label ?? embeddingModel?.provider ?? "—"
                  }
                />
                <SummaryRow
                  label="Dimensions"
                  value={
                    activeCustomModel
                      ? String(activeCustomModel.dimensions)
                      : String(embeddingModel?.dimensions ?? "—")
                  }
                  mono
                />
                <SummaryRow label="Index" value={form.indexType} />
                <SummaryRow
                  label="Chunk"
                  value={`${form.chunking.chunkSize}/${form.chunking.chunkOverlap}`}
                  mono
                />
                <SummaryRow label="Store" value={store.label} />
                <SummaryRow label="Top-K" value={String(form.topK)} mono />
              </CardContent>
            </Card>
            <Button
              variant={"default"}
              className="w-full"
              onClick={handleSave}
              disabled={saving || !dirty}
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              {saving ? "Saving…" : dirty ? "Save configuration" : "Saved"}
            </Button>
            {data?.config?.updatedAt &&
              data.config.updatedAt !== new Date(0).toISOString() && (
                <p className="text-center text-xs text-muted-foreground">
                  Last saved {new Date(data.config.updatedAt).toLocaleString()}
                </p>
              )}
          </div>
        </div>
      </div>

      <CustomEmbeddingModal
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
      <AlertDialog open={storeBlockAlertOpen} onOpenChange={setStoreBlockAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="size-5 text-destructive" />
              Cannot change vector store
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                Your index was built with{" "}
                <span className="font-semibold text-foreground">
                  {indexedVectorStore
                    ? getVectorStore(indexedVectorStore)?.label ?? indexedVectorStore
                    : form.vectorStore}
                </span>. Switching to a different vector store would make the
                existing index incompatible — vectors are bound to the store
                they were written to.
              </span>
              <span className="block">
                To use a different vector store, go to the{" "}
                <strong className="text-foreground">Index</strong> page and
                run a full re-index with your new settings.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep current store</AlertDialogCancel>
            <AlertDialogAction
              className="gap-2 bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                setStoreBlockAlertOpen(false);
                window.location.href = "/index";
              }}
            >
              <ExternalLink className="size-4" />
              Re-index from scratch
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Block: embedding model dimension change after index ──────── */}
      <AlertDialog open={modelBlockAlertOpen} onOpenChange={setModelBlockAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="size-5 text-destructive" />
              Incompatible embedding dimensions
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                Your index was built with{" "}
                <span className="font-semibold text-foreground">
                  {indexedDimensions} dimensions
                </span>. The selected model outputs a different vector size,
                which is incompatible with the existing index.
              </span>
              <span className="block">
                ✓ You can freely switch to any model that also produces{" "}
                <span className="font-semibold text-foreground">
                  {indexedDimensions}d
                </span>{" "}
                vectors. To use a different dimension size, go to the{" "}
                <strong className="text-foreground">Index</strong> page and
                run a full re-index.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep current model</AlertDialogCancel>
            <AlertDialogAction
              className="gap-2 bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                setModelBlockAlertOpen(false);
                window.location.href = "/index";
              }}
            >
              <ExternalLink className="size-4" />
              Re-index from scratch
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Delete custom model confirmation ─────────────────────────── */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete custom model?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove{" "}
              <span className="font-semibold text-foreground">
                &quot;{activeCustomModel?.modelName}&quot;
              </span>{" "}
              from your saved custom models. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={async () => {
                if (!activeCustomModel) return;
                setDeleteConfirmOpen(false);
                const modelName = activeCustomModel.modelName;
                const updatedList = (form.customEmbeddings ?? []).filter(
                  (m) => m.modelName !== modelName,
                );
                // Fall back to the first remaining custom model or the default.
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

                // Auto-save the deletion.
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
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CustomEmbeddingModal({
  open,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (config: CustomEmbeddingConfig) => void;
}) {
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [modelName, setModelName] = useState("");
  const [dimensions, setDimensions] = useState<number | null>(null);
  const [testing, setTesting] = useState(false);

  // Reset form every time the modal opens so users always start fresh.
  useEffect(() => {
    if (open) {
      setBaseUrl("");
      setApiKey("");
      setModelName("");
      setDimensions(null);
      setShowApiKey(false);
    }
  }, [open]);

  const handleTest = async () => {
    if (!baseUrl || !modelName) {
      toast.error("Base URL and Model Name are required");
      return;
    }
    setTesting(true);
    try {
      const res = await fetch("/api/config/test-embedding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl, apiKey, modelName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Connection failed");

      setDimensions(data.dimensions);
      toast.success(`Success! Detected ${data.dimensions} dimensions.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Test failed");
      setDimensions(null);
    } finally {
      setTesting(false);
    }
  };

  const handleSave = () => {
    if (!baseUrl || !modelName || !dimensions) {
      toast.error("Please test the connection to fetch dimensions first.");
      return;
    }
    onSave({ baseUrl, apiKey, modelName, dimensions });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={"max-w-xl "}>
        <DialogHeader>
          <DialogTitle>Custom Embedding Model</DialogTitle>
          <DialogDescription>
            Connect an OpenAI-compatible embedding model.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="baseUrl">Base URL</Label>
            <Input
              id="baseUrl"
              placeholder="https://api.example.com/v1"
              value={baseUrl}
              onChange={(e) => {
                setBaseUrl(e.target.value);
                setDimensions(null); // Require re-test on change
              }}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="apiKey">API Key (Optional)</Label>
            <div className="relative">
              <Input
                id="apiKey"
                type={showApiKey ? "text" : "password"}
                placeholder="sk-..."
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setDimensions(null);
                }}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
              >
                {showApiKey ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </button>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="modelName">Model Name</Label>
            <Input
              id="modelName"
              placeholder="my-embedding-model"
              value={modelName}
              onChange={(e) => {
                setModelName(e.target.value);
                setDimensions(null);
              }}
            />
          </div>
          {dimensions && (
            <div className="text-sm text-green-600 dark:text-green-400 font-medium">
              ✓ Connection verified ({dimensions} dimensions)
            </div>
          )}
        </div>
        <DialogFooter className="flex flex-row justify-between sm:justify-between items-center gap-2">
          <Button variant="outline" onClick={handleTest} disabled={testing}>
            {testing ? (
              <Loader2 className="size-4 animate-spin mr-2" />
            ) : (
              <Cloud className="size-4 mr-2" />
            )}
            Test Connection
          </Button>
          <Button
            className={"px-5"}
            onClick={handleSave}
            disabled={!dimensions}
          >
            Add Model
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SummaryRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          "truncate text-right font-medium",
          mono && "font-mono text-xs",
        )}
      >
        {value}
      </span>
    </div>
  );
}
