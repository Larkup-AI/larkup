'use client';

import { workspaceCapabilities, workspaceUrl, workspaceFetch as fetch } from '../../../host';
import { useState, useEffect } from 'react';
import useSWR from 'swr';
import { Loader2, Save, Database, Clock, Layers, SlidersHorizontal } from 'lucide-react';
import { Button } from '@larkup/workspace-ui/button';
import { Input } from '@larkup/workspace-app/components/ui/input';
import { Label } from '@larkup/workspace-ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@larkup/workspace-ui/select';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@larkup/workspace-app/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@larkup/workspace-app/components/ui/alert-dialog';
import { toast } from 'sonner';
import { useProject } from '@larkup/workspace-app/components/projects/project-provider';
import { ProviderIcon } from '@larkup/workspace-ui/provider-icon';
import {
  VECTOR_STORE_LIST,
  getVectorStore,
  validateStoreConfig,
} from '@larkup/vector-stores/registry';
import { StoreFields } from '@larkup/workspace-app/components/configure/store-fields';
import {
  validateChunkingParams,
  type RagConfig,
  type VectorStoreId,
  type IndexType,
} from '@larkup/core/types';

const INDEX_TYPES: { value: IndexType; label: string; description: string }[] = [
  {
    value: 'hybrid',
    label: 'Hybrid',
    description: 'Combines semantic understanding with keyword matching for best results.',
  },
  {
    value: 'semantic',
    label: 'Semantic',
    description: 'Uses embeddings to find conceptually similar content.',
  },
  {
    value: 'lexical',
    label: 'Lexical',
    description: 'Traditional keyword-based search using BM25 scoring.',
  },
];

const fetcher = (url: string) => fetch(url).then((r) => r.json() as Promise<{ config: RagConfig }>);

import { STORE_META } from '@larkup/workspace-app/lib/constants/stores';

export function StorageSection() {
  const { activeProject } = useProject();
  const serverId = activeProject?.id;

  const configUrl = serverId
    ? workspaceUrl(`/api/config?serverId=${encodeURIComponent(serverId)}`)
    : workspaceUrl('/api/config');
  const { data, isLoading, mutate } = useSWR(configUrl, fetcher);

  const [form, setForm] = useState<Partial<RagConfig>>({});
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pendingStore, setPendingStore] = useState<VectorStoreId | null>(null);
  const [storageChangeOpen, setStorageChangeOpen] = useState(false);
  const [clearKnowledgeBase, setClearKnowledgeBase] = useState(false);

  const { data: indexData } = useSWR(workspaceUrl('/api/index'), (url: string) =>
    fetch(url).then((r) => r.json()),
  );
  const indexedRun = indexData?.run?.status === 'completed' ? indexData.run : null;

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

  function requestStoreChange(id: VectorStoreId) {
    if (!data?.config || id === form.vectorStore) return;
    setPendingStore(id);
    setClearKnowledgeBase(false);
    setStorageChangeOpen(true);
  }

  async function confirmStoreChange() {
    if (!pendingStore) return;
    if (clearKnowledgeBase) {
      try {
        const response = await fetch(workspaceUrl('/api/documents'), { method: 'DELETE' });
        if (!response.ok) throw new Error('Could not clear the knowledge base.');
        toast.success('Knowledge base cleared.');
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Could not clear the knowledge base.');
        return;
      }
    }
    selectStore(pendingStore);
    setStorageChangeOpen(false);
    setPendingStore(null);
  }

  function handleStructuralChangeBlock() {
    toast('Cannot modify configuration', {
      description:
        'This project already has indexed data. You must create a new project to change this setting.',
      duration: Number.POSITIVE_INFINITY,
    });
  }

  async function handleSave() {
    if (!data?.config) return;

    const chunkingError = validateChunkingParams(form.chunking);
    if (chunkingError) {
      toast.error(chunkingError);
      return;
    }

    let hasError = false;
    const newErrors: Record<string, string> = {};

    if (form.vectorStore && !workspaceCapabilities().managedStorage) {
      const store = getVectorStore(form.vectorStore);
      if (store) {
        const storeErrs = validateStoreConfig(
          store,
          form.storeConfig || {},
          form.indexType || 'hybrid',
        );
        if (Object.keys(storeErrs).length > 0) {
          Object.assign(newErrors, storeErrs);
          hasError = true;
        }
      }
    }

    setErrors(newErrors);
    if (hasError) {
      toast.error('Please fill in all required fields', {
        duration: Number.POSITIVE_INFINITY,
      });
      return;
    }

    setSaving(true);
    try {
      const merged = { ...data.config, ...form };
      const res = await fetch(configUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(merged),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to save');
      await mutate(json, { revalidate: false });
      toast.success('Storage settings saved', {
        duration: Number.POSITIVE_INFINITY,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save', {
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
              value={form.indexType || 'hybrid'}
              onValueChange={(v) => {
                if (indexedRun && data?.config && v !== data.config.indexType) {
                  handleStructuralChangeBlock();
                  return;
                }
                setForm((f) => ({ ...f, indexType: v as IndexType }));
              }}
            >
              <SelectTrigger className="w-full">
                <span className="font-medium text-sm">
                  {INDEX_TYPES.find((t) => t.value === (form.indexType || 'hybrid'))?.label ??
                    'Select strategy…'}
                </span>
              </SelectTrigger>
              <SelectContent>
                {INDEX_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    <span className="flex flex-col gap-0.5">
                      <span className="font-medium text-sm">{t.label}</span>
                      <span className="text-xs text-muted-foreground">{t.description}</span>
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
            <SlidersHorizontal className="size-3.5 text-primary" />
            RAG &amp; Search
          </CardTitle>
          <CardDescription className="text-xs">
            Control how new documents are split for search. Existing documents need re-indexing to
            use new chunk settings.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs" htmlFor="chunk-strategy">
              Chunking strategy
            </Label>
            <Select
              value={form.chunking?.strategy ?? 'recursive'}
              onValueChange={(strategy) =>
                setForm((current) => ({
                  ...current,
                  chunking: {
                    ...current.chunking!,
                    strategy: strategy as RagConfig['chunking']['strategy'],
                  },
                }))
              }
            >
              <SelectTrigger id="chunk-strategy" className="w-full">
                <span className="font-medium text-sm capitalize">
                  {form.chunking?.strategy ?? 'recursive'}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recursive">Recursive · paragraphs and lines</SelectItem>
                <SelectItem value="sentence">Sentence · sentence boundaries</SelectItem>
                <SelectItem value="fixed">Fixed · equal sized windows</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-xs" htmlFor="chunk-size">
                Chunk size · tokens
              </Label>
              <Input
                id="chunk-size"
                type="number"
                min={64}
                max={8192}
                step={1}
                value={form.chunking?.chunkSize ?? 512}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    chunking: { ...current.chunking!, chunkSize: Number(event.target.value) },
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">Default: 512 · range: 64–8192</p>
            </div>
            <div className="space-y-2">
              <Label className="text-xs" htmlFor="chunk-overlap">
                Chunk overlap · tokens
              </Label>
              <Input
                id="chunk-overlap"
                type="number"
                min={0}
                max={2048}
                step={1}
                value={form.chunking?.chunkOverlap ?? 64}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    chunking: { ...current.chunking!, chunkOverlap: Number(event.target.value) },
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">
                Default: 64 · must be smaller than chunk size
              </p>
            </div>
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
            {workspaceCapabilities().managedStorage
              ? 'Cloud uses managed pgvector storage for every project.'
              : 'Local projects use LanceDB by default. Configure another available engine here.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label className="text-xs">Storage Engine</Label>
            <Select
              value={form.vectorStore || ''}
              onValueChange={(v) => {
                requestStoreChange(v as VectorStoreId);
              }}
            >
              <SelectTrigger className="w-full">
                {form.vectorStore ? (
                  <span className="flex items-center gap-2.5">
                    <ProviderIcon
                      src={STORE_META[form.vectorStore]?.iconSrc ?? ''}
                      alt={getVectorStore(form.vectorStore)?.label ?? form.vectorStore}
                      pillBg={STORE_META[form.vectorStore]?.pillBg ?? undefined}
                      size={16}
                    />
                    <span className="font-medium text-sm">
                      {getVectorStore(form.vectorStore)?.label ?? form.vectorStore}
                    </span>
                    {form.vectorStore ===
                      (workspaceCapabilities().managedStorage ? 'pgvector' : 'lancedb') && (
                      <span className="text-xs text-muted-foreground">Default</span>
                    )}
                  </span>
                ) : (
                  <span className="text-muted-foreground">Select storage engine…</span>
                )}
              </SelectTrigger>
              <SelectContent>
                {VECTOR_STORE_LIST.map((s) => {
                  const meta = STORE_META[s.id];
                  const isUnavailable =
                    (s.installStatus === 'coming-soon' &&
                      !(workspaceCapabilities().managedStorage && s.id === 'pgvector')) ||
                    Boolean(
                      workspaceCapabilities().vectorStores &&
                      !workspaceCapabilities().vectorStores!.includes(s.id),
                    );
                  return (
                    <SelectItem
                      key={s.id}
                      value={s.id}
                      disabled={isUnavailable}
                      className={isUnavailable ? 'opacity-50' : ''}
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
                          <span className="font-medium text-sm">{s.label}</span>
                          {s.id ===
                            (workspaceCapabilities().managedStorage ? 'pgvector' : 'lancedb') && (
                            <span className="text-[10px] text-muted-foreground">Default</span>
                          )}
                          {isUnavailable && (
                            <span className="h-3.5 px-1 text-[9px] font-medium shrink-0 text-muted-foreground border rounded-full flex items-center bg-transparent">
                              <Clock className="size-2.5 mr-0.5" />
                              Coming soon
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

          {form.vectorStore && !workspaceCapabilities().managedStorage && (
            <div className="border-t pt-4">
              <StoreFields
                store={getVectorStore(form.vectorStore)}
                values={form.storeConfig || {}}
                errors={errors}
                onChange={setStoreValue}
                indexType={form.indexType || 'hybrid'}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button size="lg" disabled={saving || !dirty} onClick={handleSave} className="gap-1.5 px-4">
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          Save settings
        </Button>
      </div>

      <AlertDialog open={storageChangeOpen} onOpenChange={setStorageChangeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change vector storage?</AlertDialogTitle>
            <AlertDialogDescription>
              Your existing indexed vectors stay in the current storage engine and will not be
              available after this change. Keep the knowledge base to re-index it in the new store,
              or clear it intentionally below.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={clearKnowledgeBase}
              onChange={(event) => setClearKnowledgeBase(event.target.checked)}
            />
            <span>
              <span className="font-medium">Clear knowledge base</span>
              <span className="block text-xs text-muted-foreground">
                Permanently remove documents and the current vector index before changing storage.
              </span>
            </span>
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingStore(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmStoreChange}>
              {clearKnowledgeBase ? 'Clear and change storage' : 'Keep documents and continue'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
