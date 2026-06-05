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
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
} from "@/core/types";
import {
  EMBEDDING_MODELS,
  getEmbeddingModel,
} from "@/core/embeddings/registry";
import {
  getVectorStore,
  validateStoreConfig,
  VECTOR_STORE_LIST,
} from "@/core/vector-stores/registry";
import { StoreFields } from "@/components/configure/store-fields";

const fetcher = (url: string) =>
  fetch(url).then((r) => r.json() as Promise<{ config: RagConfig }>);

const INDEX_TYPES: { value: IndexType; label: string; hint: string }[] = [
  { value: "lexical", label: "Lexical", hint: "Keyword / BM25 matching" },
  { value: "semantic", label: "Semantic", hint: "Pure vector similarity" },
  { value: "hybrid", label: "Hybrid", hint: "Lexical + semantic, reranked" },
];

const STORE_ICON: Record<VectorStoreId, typeof Cloud> = {
  lancedb: HardDrive,
  pinecone: Cloud,
};

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
    if (id === form.vectorStore) return; // already selected — nothing to do

    // Save current storeConfig to cache before switching away.
    storeConfigCache.current[form.vectorStore] = form.storeConfig;

    const next = getVectorStore(id);
    // Restore from cache if available, otherwise seed from field defaults.
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
      // Test connection before saving
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
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EMBEDDING_MODELS.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.label}
                    </SelectItem>
                  ))}
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

          {/* Index type + chunking */}
          <Card>
            <CardHeader>
              <CardTitle>Indexing</CardTitle>
              <CardDescription>
                How documents are matched at retrieval time.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <Tabs
                value={form.indexType}
                onValueChange={(v) => set("indexType", v as IndexType)}
              >
                <TabsList className="grid w-full grid-cols-3">
                  {INDEX_TYPES.map((t) => (
                    <TabsTrigger key={t.value} value={t.value}>
                      {t.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
              <p className="text-xs text-muted-foreground">
                {INDEX_TYPES.find((t) => t.value === form.indexType)?.hint}
              </p>

              <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                <CollapsibleTrigger className="-ml-2 inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                  <ChevronDown
                    className={cn(
                      "size-4 transition-transform",
                      advancedOpen && "rotate-180",
                    )}
                  />
                  Advanced chunking
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-4">
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

          {/* Vector store */}
          <Card>
            <CardHeader>
              <CardTitle>Vector store</CardTitle>
              <CardDescription>
                The generated server ships only the selected store&apos;s
                dependencies — nothing else.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2">
                {VECTOR_STORE_LIST.map((s) => {
                  const Icon = STORE_ICON[s.id];
                  const active = form.vectorStore === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => selectStore(s.id)}
                      className={cn(
                        "flex flex-col gap-2 rounded-lg border p-4 text-left transition-colors",
                        active
                          ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                          : "border-border hover:border-foreground/20 hover:bg-accent/40",
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2 font-medium">
                          <Icon
                            className={cn(
                              "size-4",
                              active ? "text-primary" : "text-muted-foreground",
                            )}
                          />
                          {s.label}
                        </span>
                        <Badge
                          variant="outline"
                          className="text-[10px] font-mono uppercase"
                        >
                          {s.runtime}
                        </Badge>
                      </div>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {s.description}
                      </p>
                    </button>
                  );
                })}
              </div>

              <div className="rounded-lg border border-border bg-muted/30 p-4">
                <p className="mb-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {store.label} configuration
                </p>
                <StoreFields
                  store={store}
                  values={form.storeConfig}
                  errors={errors}
                  onChange={setStoreValue}
                  indexType={form.indexType}
                />
                <div className="mt-4 flex justify-end">
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
