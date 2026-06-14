"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import {
  ChevronDown,
  Cloud,
  HardDrive,
  Loader2,
  Save,
  Sparkles,
  Database,
  Zap,
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
  SelectValue,
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

const INDEX_TYPES: { value: IndexType; label: string; hint: string; icon: typeof Zap }[] = [
  { value: "lexical", label: "Lexical", hint: "Keyword / BM25 matching", icon: Zap },
  { value: "semantic", label: "Semantic", hint: "Pure vector similarity", icon: Sparkles },
  { value: "hybrid", label: "Hybrid", hint: "Lexical + semantic, reranked", icon: Database },
];

// ── Provider branding ────────────────────────────────────────────────────────

type ProviderMeta = {
  label: string;
  color: string;        // tailwind bg colour class for the icon pill
  textColor: string;    // text colour on the pill
  icon: React.ReactNode;
};

const PROVIDER_META: Record<EmbeddingProvider, ProviderMeta> = {
  openai: {
    label: "OpenAI",
    color: "bg-emerald-500/15",
    textColor: "text-emerald-600 dark:text-emerald-400",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="size-3">
        <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.759a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 8.072a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 8.072zm16.597 3.855-5.833-3.387L15.119 7.4a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.671zm2.01-3.023-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08-4.778 2.758a.795.795 0 0 0-.393.681zm1.097-2.365 2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
      </svg>
    ),
  },
  google: {
    label: "Google",
    color: "bg-blue-500/15",
    textColor: "text-blue-600 dark:text-blue-400",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="size-3">
        <path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z" />
      </svg>
    ),
  },
  cohere: {
    label: "Cohere",
    color: "bg-coral-500/15 bg-orange-500/15",
    textColor: "text-orange-600 dark:text-orange-400",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="size-3">
        <path d="M21.6 0H2.4A2.4 2.4 0 0 0 0 2.4v19.2A2.4 2.4 0 0 0 2.4 24h19.2a2.4 2.4 0 0 0 2.4-2.4V2.4A2.4 2.4 0 0 0 21.6 0zM12 19.2a7.2 7.2 0 1 1 0-14.4 7.2 7.2 0 0 1 0 14.4z" />
      </svg>
    ),
  },
  voyage: {
    label: "Voyage AI",
    color: "bg-violet-500/15",
    textColor: "text-violet-600 dark:text-violet-400",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="size-3">
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    ),
  },
  mistral: {
    label: "Mistral",
    color: "bg-amber-500/15",
    textColor: "text-amber-600 dark:text-amber-400",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="size-3">
        <rect x="0" y="0" width="6" height="6" />
        <rect x="9" y="0" width="6" height="6" />
        <rect x="18" y="0" width="6" height="6" />
        <rect x="0" y="9" width="6" height="6" />
        <rect x="9" y="9" width="6" height="6" />
        <rect x="0" y="18" width="6" height="6" />
        <rect x="9" y="18" width="6" height="6" />
        <rect x="18" y="18" width="6" height="6" />
      </svg>
    ),
  },
  jina: {
    label: "Jina AI",
    color: "bg-rose-500/15",
    textColor: "text-rose-600 dark:text-rose-400",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="size-3">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z" />
      </svg>
    ),
  },
  nomic: {
    label: "Nomic",
    color: "bg-teal-500/15",
    textColor: "text-teal-600 dark:text-teal-400",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="size-3">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2a10 10 0 0 1 10 10A10 10 0 0 1 12 22 10 10 0 0 1 2 12 10 10 0 0 1 12 2m0 2a8 8 0 0 0-8 8 8 8 0 0 0 8 8 8 8 0 0 0 8-8 8 8 0 0 0-8-8z" />
      </svg>
    ),
  },
};

// ── Vector-store branding ────────────────────────────────────────────────────

type StoreMeta = {
  color: string;
  textColor: string;
  icon: React.ReactNode;
};

const STORE_META: Record<VectorStoreId, StoreMeta> = {
  lancedb: {
    color: "bg-yellow-500/15",
    textColor: "text-yellow-600 dark:text-yellow-400",
    icon: <HardDrive className="size-3.5" />,
  },
  pinecone: {
    color: "bg-green-500/15",
    textColor: "text-green-600 dark:text-green-400",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5">
        <path d="M12 2L8 8l4-1 4 1-4-6zM8 8l-4 6h4l4-1-4-5zM16 8l4 6h-4l-4-1 4-5zM4 14l4 6 4-3-8-3zM20 14l-4 6-4-3 8-3z" />
      </svg>
    ),
  },
  weaviate: {
    color: "bg-green-500/15",
    textColor: "text-green-700 dark:text-green-400",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5">
        <path d="M12 2 3 7v10l9 5 9-5V7L12 2zm0 2.236L19.09 8 12 11.764 4.91 8 12 4.236zM4 9.618l7 3.888V20.5l-7-3.888V9.618zm9 3.888 7-3.888v7l-7 3.888v-7z" />
      </svg>
    ),
  },
  qdrant: {
    color: "bg-red-500/15",
    textColor: "text-red-600 dark:text-red-400",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5">
        <path d="m12 1-9 5.197V17.8L12 23l9-5.197V6.197L12 1zm6.75 14.948L12 19.646l-6.75-3.698V8.052L12 4.354l6.75 3.698v7.896z" />
      </svg>
    ),
  },
  chroma: {
    color: "bg-purple-500/15",
    textColor: "text-purple-600 dark:text-purple-400",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
      </svg>
    ),
  },
  pgvector: {
    color: "bg-blue-500/15",
    textColor: "text-blue-600 dark:text-blue-400",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5">
        <path d="M12 2C6.477 2 2 4.686 2 8v8c0 3.314 4.477 6 10 6s10-2.686 10-6V8c0-3.314-4.477-6-10-6zm0 2c4.411 0 8 1.79 8 4s-3.589 4-8 4-8-1.79-8-4 3.589-4 8-4zm8 6.277V16c0 2.21-3.589 4-8 4s-8-1.79-8-4v-5.723C5.799 11.343 8.702 12 12 12s6.201-.657 8-1.723z" />
      </svg>
    ),
  },
  supabase: {
    color: "bg-emerald-500/15",
    textColor: "text-emerald-600 dark:text-emerald-400",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5">
        <path d="M11.9 1.036c-.015-.986-1.26-1.41-1.874-.637L.764 12.05C.113 12.907.697 14.142 1.78 14.142h9.217c.97 0 1.755.784 1.755 1.75v7.072c.015.986 1.26 1.41 1.874.638l9.262-11.652c.651-.856.067-2.091-1.016-2.091h-9.218c-.97 0-1.754-.784-1.754-1.75V1.036z" />
      </svg>
    ),
  },
};

// Group embedding models by provider for the grouped select
const EMBEDDING_BY_PROVIDER = EMBEDDING_MODELS.reduce<
  Record<string, typeof EMBEDDING_MODELS>
>((acc, m) => {
  (acc[m.provider] ??= []).push(m);
  return acc;
}, {});

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
      // Seed the cache with the persisted store config.
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

  // When switching stores, seed defaults for the new store's fields
  // but restore from cache if the user already filled them in before.
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
        {/* Main column */}
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

          {/* Embedding model */}
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
            <CardContent className="space-y-3">
              <Select
                value={form.embeddingModelId}
                onValueChange={(v) =>
                  set("embeddingModelId", (v as string) ?? "")
                }
              >
                <SelectTrigger className="w-full">
                  {embeddingModel && embeddingMeta ? (
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          "inline-flex items-center justify-center rounded size-5 shrink-0",
                          embeddingMeta.color,
                          embeddingMeta.textColor,
                        )}
                      >
                        {embeddingMeta.icon}
                      </span>
                      <span className="text-xs font-medium text-muted-foreground">
                        {embeddingMeta.label}
                      </span>
                      <span className="font-medium">{embeddingModel.label}</span>
                    </span>
                  ) : (
                    <SelectValue placeholder="Select a model…" />
                  )}
                </SelectTrigger>
                <SelectContent className="max-h-[320px]">
                  {Object.entries(EMBEDDING_BY_PROVIDER).map(([provider, models]) => {
                    const meta = PROVIDER_META[provider as EmbeddingProvider];
                    return (
                      <SelectGroup key={provider}>
                        <SelectLabel className="flex items-center gap-2 py-1.5">
                          <span
                            className={cn(
                              "inline-flex items-center justify-center rounded size-5",
                              meta?.color,
                              meta?.textColor,
                            )}
                          >
                            {meta?.icon}
                          </span>
                          {meta?.label ?? provider}
                        </SelectLabel>
                        {models.map((m) => (
                          <SelectItem key={m.id} value={m.id} className="pl-8">
                            <span className="flex items-center gap-2">
                              {m.label}
                              <span className="text-[10px] text-muted-foreground font-mono">
                                {m.dimensions}d
                              </span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    );
                  })}
                </SelectContent>
              </Select>
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
            </CardContent>
          </Card>

          {/* Indexing + Vector Store — merged card */}
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
            <CardContent className="space-y-6">
              {/* Row: index type (radio) + vector store (dropdown) side-by-side */}
              <div className="grid gap-5 sm:grid-cols-2">
                {/* Index type — vertical radio group */}
                <div className="space-y-2">
                  <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Index type
                  </Label>
                  <div className="flex flex-col gap-1.5">
                    {INDEX_TYPES.map((t) => {
                      const active = form.indexType === t.value;
                      const Icon = t.icon;
                      return (
                        <button
                          key={t.value}
                          type="button"
                          onClick={() => set("indexType", t.value)}
                          className={cn(
                            "group relative flex items-center gap-3 rounded-lg border px-3.5 py-2.5 text-left transition-all duration-200",
                            active
                              ? "border-primary/50 bg-primary/5 shadow-[0_0_0_1px_hsl(var(--primary)/0.2)]"
                              : "border-border hover:border-muted-foreground/30 hover:bg-accent/50",
                          )}
                        >
                          {/* Radio dot */}
                          <span
                            className={cn(
                              "flex size-4 shrink-0 items-center justify-center rounded-full border-2 transition-all duration-200",
                              active
                                ? "border-primary bg-primary"
                                : "border-muted-foreground/40 group-hover:border-muted-foreground/70",
                            )}
                          >
                            {active && (
                              <span className="size-1.5 rounded-full bg-primary-foreground" />
                            )}
                          </span>
                          <span
                            className={cn(
                              "flex items-center gap-2 transition-colors duration-150",
                              active ? "text-foreground" : "text-muted-foreground group-hover:text-foreground",
                            )}
                          >
                            <Icon className={cn("size-3.5", active && "text-primary")} />
                            <span className="font-medium text-sm">{t.label}</span>
                          </span>
                          <span className="ml-auto text-[11px] text-muted-foreground/70 hidden sm:block">
                            {t.hint}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {/* Hint below on mobile */}
                  <p className="text-xs text-muted-foreground sm:hidden">
                    {INDEX_TYPES.find((t) => t.value === form.indexType)?.hint}
                  </p>
                </div>

                {/* Vector store — dropdown with provider icon */}
                <div className="space-y-2">
                  <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Vector store
                  </Label>
                  <Select
                    value={form.vectorStore}
                    onValueChange={(v) => selectStore(v as VectorStoreId)}
                  >
                    <SelectTrigger className="w-full h-auto py-2.5">
                      {storeMeta ? (
                        <span className="flex items-center gap-2.5">
                          <span
                            className={cn(
                              "inline-flex items-center justify-center rounded size-6 shrink-0",
                              storeMeta.color,
                              storeMeta.textColor,
                            )}
                          >
                            {storeMeta.icon}
                          </span>
                          <span className="flex flex-col items-start">
                            <span className="font-medium text-sm leading-tight">
                              {store.label}
                            </span>
                            <span className="text-[10px] text-muted-foreground leading-tight">
                              {store.runtime === "both"
                                ? "local / cloud"
                                : store.runtime}
                            </span>
                          </span>
                        </span>
                      ) : (
                        <SelectValue placeholder="Select a vector store…" />
                      )}
                    </SelectTrigger>
                    <SelectContent>
                      {VECTOR_STORE_LIST.map((s) => {
                        const meta = STORE_META[s.id];
                        return (
                          <SelectItem key={s.id} value={s.id}>
                            <span className="flex items-center gap-2.5 w-full">
                              <span
                                className={cn(
                                  "inline-flex items-center justify-center rounded size-6 shrink-0",
                                  meta?.color,
                                  meta?.textColor,
                                )}
                              >
                                {meta?.icon}
                              </span>
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
                    <Badge variant="outline" className="text-[10px] font-mono uppercase">
                      {store.runtime}
                    </Badge>
                    {store.docsUrl && (
                      <a
                        href={store.docsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] text-muted-foreground underline-offset-2 hover:underline hover:text-foreground transition-colors"
                      >
                        docs ↗
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
                <CollapsibleContent className="overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:slide-out-to-top-1 data-[state=open]:slide-in-from-top-1 pt-4">
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
                          <SelectValue />
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

        {/* Summary rail */}
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
                  value={embeddingMeta?.label ?? (embeddingModel?.provider ?? "—")}
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
