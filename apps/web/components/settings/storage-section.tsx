"use client";

import { useState, useEffect } from "react";
import useSWR from "swr";
import { Loader2, Save, Database, Clock, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
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
  CardFooter,
} from "@/components/ui/card";
import { toast } from "sonner";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import { ProviderIcon } from "@/components/ui/provider-icon";
import {
  VECTOR_STORE_LIST,
  getVectorStore,
  validateStoreConfig,
} from "@larkup/vector-stores/registry";
import { StoreFields } from "@/components/configure/store-fields";
import type { RagConfig, VectorStoreId, IndexType } from "@larkup/core/types";

const INDEX_TYPES: { value: IndexType; label: string; description: string }[] = [
  {
    value: "hybrid",
    label: "Hybrid",
    description: "Combines semantic understanding with keyword matching for best results.",
  },
  {
    value: "semantic",
    label: "Semantic",
    description: "Uses embeddings to find conceptually similar content.",
  },
  {
    value: "lexical",
    label: "Lexical",
    description: "Traditional keyword-based search using BM25 scoring.",
  },
];

const fetcher = (url: string) =>
  fetch(url).then((r) => r.json() as Promise<{ config: RagConfig }>);

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

export function StorageSection() {
  const { activeServer } = useWorkspace();
  const serverId = activeServer?.id;

  const configUrl = serverId
    ? `/api/config?serverId=${encodeURIComponent(serverId)}`
    : "/api/config";
  const { data, isLoading, mutate } = useSWR(configUrl, fetcher);

  const [form, setForm] = useState<Partial<RagConfig>>({});
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: indexData } = useSWR("/api/index", (url: string) =>
    fetch(url).then((r) => r.json()),
  );
  const indexedRun =
    indexData?.run?.status === "completed" ? indexData.run : null;

  useEffect(() => {
    if (data?.config) {
      setForm(data.config);
    }
  }, [data]);

  const dirty = JSON.stringify(form) !== JSON.stringify(data?.config ?? {});

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
    setForm((f) => ({
      ...f,
      storeConfig: { ...f.storeConfig, [key]: value },
    }));
    clearError(key);
  };

  const selectStore = (id: VectorStoreId) => {
    setForm((f) => ({ ...f, vectorStore: id, storeConfig: {} }));
  };

  function handleStructuralChangeBlock() {
    toast("Cannot modify configuration", {
      description:
        "This project already has indexed data. You must create a new project to change this setting.",
      duration: Number.POSITIVE_INFINITY,
    });
  }

  async function handleSave() {
    if (!data?.config) return;

    let hasError = false;
    const newErrors: Record<string, string> = {};

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
      toast.error("Please fill in all required fields", {
        duration: Number.POSITIVE_INFINITY,
      });
      return;
    }

    setSaving(true);
    try {
      const merged = { ...data.config, ...form };
      const res = await fetch(configUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(merged),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to save");
      await mutate(json, { revalidate: false });
      toast.success("Storage settings saved", {
        duration: Number.POSITIVE_INFINITY,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save", {
        duration: Number.POSITIVE_INFINITY,
      });
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Storage</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Where your processed data is stored and indexed.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Layers className="size-3.5 text-primary" />
            Indexing Strategy
          </CardTitle>
          <CardDescription className="text-xs">
            How your documents are indexed for retrieval.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs">Strategy</Label>
            <Select
              value={form.indexType || "hybrid"}
              onValueChange={(v) => {
                if (
                  indexedRun &&
                  data?.config &&
                  v !== data.config.indexType
                ) {
                  handleStructuralChangeBlock();
                  return;
                }
                setForm((f) => ({ ...f, indexType: v as IndexType }));
              }}
            >
              <SelectTrigger className="w-full">
                <span className="font-medium text-sm">
                  {INDEX_TYPES.find((t) => t.value === (form.indexType || "hybrid"))?.label ?? "Select strategy…"}
                </span>
              </SelectTrigger>
              <SelectContent>
                {INDEX_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    <span className="flex flex-col gap-0.5">
                      <span className="font-medium text-sm">{t.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {t.description}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Database className="size-3.5 text-primary" />
            Storage Engine
          </CardTitle>
          <CardDescription className="text-xs">
            Configure your vector database connection.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label className="text-xs">Storage Engine</Label>
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
                    Select storage engine…
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
        <CardFooter className="flex justify-end pt-4 border-t">
          <Button
            size="sm"
            disabled={saving || !dirty}
            onClick={handleSave}
            className="gap-1.5"
          >
            {saving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            Save
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
