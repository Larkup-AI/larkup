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
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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

export function ConfigureForm() {
  const { data, isLoading, mutate } = useSWR("/api/config", fetcher);
  const [form, setForm] = useState<RagConfig>(DEFAULT_CONFIG);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
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
  const embeddingModel = getEmbeddingModel(form.embeddingModelId);
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

  const selectStore = (id: VectorStoreId) => {
    if (id === form.vectorStore) return;
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
              <Select
                value={form.embeddingModelId}
                onValueChange={(v) =>
                  set("embeddingModelId", (v as string) ?? "")
                }
              >
                <SelectTrigger className="w-full">
                  {embeddingModel && embeddingMeta ? (
                    <span className="flex items-center gap-2.5">
                      <ProviderIcon
                        src={embeddingMeta.iconSrc}
                        alt={embeddingMeta.label}
                        pillBg={embeddingMeta.pillBg}
                        size={20}
                      />
                      <span className="flex flex-col items-start leading-none">
                        {/* <span className="text-[10px] text-muted-foreground">
                          {embeddingMeta.label}
                        </span> */}
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
                      const meta = PROVIDER_META[provider as EmbeddingProvider];
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
                </SelectContent>
              </Select>

              {/* Model info badges */}
              {embeddingModel && (
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
              )}

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
                  value={String(embeddingModel?.dimensions ?? "—")}
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
    </div>
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
