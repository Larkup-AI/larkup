'use client';

import { useState, useEffect, useMemo } from 'react';
import useSWR from 'swr';
import {
  Eye,
  EyeOff,
  Loader2,
  Save,
  Sparkles,
  MessageCircle,
  Database,
  Clock,
  Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectGroup,
  SelectLabel,
} from '@/components/ui/select';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card';
import { toast } from 'sonner';
import { useWorkspace } from '@/components/workspace/workspace-provider';
import { PROVIDER_META, ProviderIcon } from '@/components/ui/provider-icon';
import { ServerFormDialog } from '@/components/workspace/server-form-dialog';

import { CustomModelModal } from '@/components/configure/custom-model-modal';
import type { RagConfig, CustomModelConfig, EmbeddingModelDescriptor } from '@larkup/core/types';

const fetcher = (url: string) => fetch(url).then((r) => r.json() as Promise<{ config: RagConfig }>);

const PROVIDER_LIST = [
  'vercel_ai_gateway',
  'openai',
  'google',
  'deepseek',
  'mistral',
  'voyage',
  'jina',
  'nomic',
] as const;

export function ModelsSection() {
  const { activeServer } = useWorkspace();
  const serverId = activeServer?.id;

  const configUrl = serverId
    ? `/api/config?serverId=${encodeURIComponent(serverId)}`
    : '/api/config';
  const { data, isLoading, mutate } = useSWR(configUrl, fetcher);

  const [form, setForm] = useState<Partial<RagConfig>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [showEmbeddingKey, setShowEmbeddingKey] = useState(false);
  const [showChatKey, setShowChatKey] = useState(false);

  const currentChatProvider = form.chatProvider || form.embeddingProvider || 'openai';
  const statusKey = serverId
    ? `/api/chat/status?serverId=${encodeURIComponent(serverId)}&provider=${currentChatProvider}`
    : `/api/chat/status?provider=${currentChatProvider}`;
  const { data: chatStatus } = useSWR(statusKey, (url: string) => fetch(url).then((r) => r.json()));

  const embeddingModels: EmbeddingModelDescriptor[] = chatStatus?.availableEmbeddingModels ?? [];
  const EMBEDDING_BY_PROVIDER = useMemo(() => {
    return embeddingModels.reduce<Record<string, EmbeddingModelDescriptor[]>>((acc, m) => {
      (acc[m.provider] ??= []).push(m);
      return acc;
    }, {});
  }, [embeddingModels]);

  const { data: indexData } = useSWR('/api/index', (url: string) =>
    fetch(url).then((r) => r.json()),
  );
  const indexedRun = indexData?.run?.status === 'completed' ? indexData.run : null;

  const [newServerModalOpen, setNewServerModalOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [customEmbeddingModalOpen, setCustomEmbeddingModalOpen] = useState(false);
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

  const dirtyEmbedding =
    form.embeddingProvider !== data?.config?.embeddingProvider ||
    form.embeddingModelId !== data?.config?.embeddingModelId ||
    form.embeddingApiKey !== data?.config?.embeddingApiKey ||
    JSON.stringify(form.customEmbeddings) !== JSON.stringify(data?.config?.customEmbeddings);

  const dirtyChat =
    form.chatProvider !== data?.config?.chatProvider ||
    form.chatModelId !== data?.config?.chatModelId ||
    form.chatApiKey !== data?.config?.chatApiKey ||
    JSON.stringify(form.customChatModels) !== JSON.stringify(data?.config?.customChatModels);

  const clearError = (key: string) => {
    if (errors[key]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  function handleStructuralChangeBlock() {
    toast('Cannot modify configuration', {
      description:
        'This project already has indexed data. You must create a new project to change this setting.',
      duration: Number.POSITIVE_INFINITY,
      action: {
        label: 'New Project',
        onClick: () => setNewServerModalOpen(true),
      },
    });
  }

  async function handleSave(section: 'embedding' | 'chat') {
    if (!data?.config) return;

    let hasError = false;
    const newErrors: Record<string, string> = {};

    if (section === 'embedding') {
      if (!form.embeddingProvider) {
        newErrors.embeddingProvider = 'Required';
        hasError = true;
      }
      if (!form.embeddingApiKey) {
        newErrors.embeddingApiKey = 'Required';
        hasError = true;
      }
    } else if (section === 'chat') {
      if (!form.chatProvider) {
        newErrors.chatProvider = 'Required';
        hasError = true;
      }
      if (!form.chatApiKey) {
        newErrors.chatApiKey = 'Required';
        hasError = true;
      }
    }

    setErrors(newErrors);
    if (hasError) {
      toast.error('Please fill in all required fields', {
        duration: Number.POSITIVE_INFINITY,
      });
      return;
    }

    setSaving(section);
    try {
      const payload = { ...data.config };

      if (section === 'embedding') {
        if (form.embeddingProvider !== undefined)
          payload.embeddingProvider = form.embeddingProvider;
        if (form.embeddingModelId !== undefined) payload.embeddingModelId = form.embeddingModelId;
        if (form.embeddingApiKey !== undefined) payload.embeddingApiKey = form.embeddingApiKey;
        if (form.customEmbeddings !== undefined) payload.customEmbeddings = form.customEmbeddings;
      } else if (section === 'chat') {
        if (form.chatProvider !== undefined) payload.chatProvider = form.chatProvider;
        if (form.chatModelId !== undefined) payload.chatModelId = form.chatModelId;
        if (form.chatApiKey !== undefined) payload.chatApiKey = form.chatApiKey;
        if (form.customChatModels !== undefined) payload.customChatModels = form.customChatModels;
      }

      const verifyRes = await fetch('/api/config/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeddingProvider: payload.embeddingProvider,
          embeddingApiKey: payload.embeddingApiKey,
          embeddingModelId: payload.embeddingModelId,
          customEmbeddings: payload.customEmbeddings,
          chatProvider: payload.chatProvider,
          chatApiKey: payload.chatApiKey,
          chatModelId: payload.chatModelId,
          customChatModels: payload.customChatModels,
        }),
      });

      if (!verifyRes.ok) {
        const err = await verifyRes.json();
        throw new Error(err.error || 'Verification failed');
      }

      const res = await fetch(configUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to save');

      setForm((prev) => ({ ...prev, ...json.config }));
      await mutate(json, { revalidate: false });
      toast.success('AI model settings saved', {
        duration: Number.POSITIVE_INFINITY,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save', {
        duration: Number.POSITIVE_INFINITY,
      });
    } finally {
      setSaving(null);
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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">AI Models</h2>
          <p className="text-sm text-muted-foreground">
            Configure the AI models that power your knowledge base.
          </p>
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
            embeddingProvider: 'custom',
            embeddingModelId: `custom:${cfg.modelName}`,
            customEmbeddings: [cfg],
          });
          clearError('embeddingProvider');
        }}
      />
      <CustomModelModal
        type="chat"
        open={customChatModalOpen}
        onOpenChange={setCustomChatModalOpen}
        onSave={(cfg) => {
          setForm({
            ...form,
            chatProvider: 'custom',
            chatModelId: `custom:${cfg.modelName}`,
            customChatModels: [cfg],
          });
          clearError('chatProvider');
        }}
      />

      {/* Embedding Provider */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Sparkles className="size-3.5 text-primary" />
            Embedding Model
          </CardTitle>
          <CardDescription className="text-xs">
            Transforms your documents into searchable representations.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Provider</Label>
            <div className="flex gap-2">
              <Select
                value={form.embeddingProvider ?? 'openai'}
                onValueChange={(v: any) => {
                  if (indexedRun && data?.config && v !== data.config.embeddingProvider) {
                    handleStructuralChangeBlock();
                    return;
                  }
                  setForm({
                    ...form,
                    embeddingProvider: v,
                    embeddingModelId: '',
                    chatProvider:
                      !form.chatProvider || form.chatProvider === form.embeddingProvider
                        ? v
                        : form.chatProvider,
                    chatModelId:
                      !form.chatProvider || form.chatProvider === form.embeddingProvider
                        ? ''
                        : form.chatModelId,
                  });
                  clearError('embeddingProvider');
                  clearError('chatProvider');
                }}
              >
                <SelectTrigger
                  className={cn('w-full', errors.embeddingProvider && 'border-destructive')}
                >
                  <span className="flex items-center gap-2">
                    {PROVIDER_META[
                      (form.embeddingProvider ?? 'openai') as keyof typeof PROVIDER_META
                    ] ? (
                      <>
                        <ProviderIcon
                          src={
                            PROVIDER_META[form.embeddingProvider as keyof typeof PROVIDER_META]
                              ?.iconSrc ?? ''
                          }
                          alt={
                            PROVIDER_META[form.embeddingProvider as keyof typeof PROVIDER_META]
                              ?.label ?? ''
                          }
                          pillBg={
                            PROVIDER_META[form.embeddingProvider as keyof typeof PROVIDER_META]
                              ?.pillBg ?? undefined
                          }
                          size={16}
                        />
                        {PROVIDER_META[form.embeddingProvider as keyof typeof PROVIDER_META]
                          ?.label ?? form.embeddingProvider}
                      </>
                    ) : (
                      form.embeddingProvider || 'Select provider'
                    )}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {PROVIDER_LIST.filter(
                    (key) =>
                      (EMBEDDING_BY_PROVIDER[key] && EMBEDDING_BY_PROVIDER[key].length > 0) ||
                      key === 'vercel_ai_gateway',
                  ).map((key) => {
                    const meta = PROVIDER_META[key as keyof typeof PROVIDER_META];
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
                            {key === 'vercel_ai_gateway' && ' (Recommended)'}
                          </span>
                        </div>
                      </SelectItem>
                    );
                  })}
                  {form.customEmbeddings?.map((cfg) => (
                    <SelectItem key={`custom:${cfg.modelName}`} value="custom">
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

          <div className="space-y-1.5">
            <Label className="text-xs">Model</Label>
            <Select
              value={isOtherEmbedding ? 'other' : form.embeddingModelId || ''}
              onValueChange={(v: string | null) => {
                if (!v) return;
                if (v === 'other') {
                  setIsOtherEmbedding(true);
                  return;
                }
                setIsOtherEmbedding(false);
                if (indexedRun && data?.config && v !== data.config.embeddingModelId) {
                  handleStructuralChangeBlock();
                  return;
                }
                setForm({ ...form, embeddingModelId: v });
                clearError('embeddingModelId');
              }}
            >
              <SelectTrigger className="w-full">
                <span>{form.embeddingModelId || 'Default'}</span>
              </SelectTrigger>
              <SelectContent className="max-h-[320px]">
                {Object.entries(EMBEDDING_BY_PROVIDER)
                  .filter(
                    ([provider]) =>
                      form.embeddingProvider === 'vercel_ai_gateway' ||
                      provider === form.embeddingProvider ||
                      provider === 'deepseek',
                  )
                  .map(([provider, models]) => {
                    const meta = PROVIDER_META[provider as keyof typeof PROVIDER_META];
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
                          <span className="font-medium">{meta?.label ?? provider}</span>
                        </SelectLabel>
                        {models.map((m) => (
                          <SelectItem key={m.id} value={m.id} className="pl-8">
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
                    Other...
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            {isOtherEmbedding && (
              <Input
                placeholder="Enter custom model ID"
                value={form.embeddingModelId || ''}
                onChange={(e) => setForm({ ...form, embeddingModelId: e.target.value })}
                className="mt-2"
              />
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">API Key</Label>
            <div className="relative">
              <Input
                type={showEmbeddingKey ? 'text' : 'password'}
                value={form.embeddingApiKey || ''}
                onChange={(e) => {
                  setForm({
                    ...form,
                    embeddingApiKey: e.target.value,
                    chatApiKey:
                      !form.chatApiKey || form.chatApiKey === form.embeddingApiKey
                        ? e.target.value
                        : form.chatApiKey,
                  });
                  clearError('embeddingApiKey');
                  clearError('chatApiKey');
                }}
                placeholder="sk-..."
                className={cn('pr-10', errors.embeddingApiKey && 'border-destructive')}
              />
              <button
                type="button"
                onClick={() => setShowEmbeddingKey(!showEmbeddingKey)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
              >
                {showEmbeddingKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex justify-end pt-4 border-t">
          <Button
            size="sm"
            disabled={saving === 'embedding' || !dirtyEmbedding}
            onClick={() => handleSave('embedding')}
            className="gap-1.5"
          >
            {saving === 'embedding' ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            Save
          </Button>
        </CardFooter>
      </Card>

      {/* Chat (LLM) Provider */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <MessageCircle className="size-3.5 text-primary" />
            Chat Model
          </CardTitle>
          <CardDescription className="text-xs">
            Powers the AI assistant that answers questions from your knowledge base. Leave blank to
            use the same provider as embedding.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Provider</Label>
            <div className="flex gap-2">
              <Select
                value={form.chatProvider || form.embeddingProvider || 'openai'}
                onValueChange={(v: any) => {
                  setForm({ ...form, chatProvider: v, chatModelId: '' });
                  clearError('chatProvider');
                }}
              >
                <SelectTrigger
                  className={cn('w-full', errors.chatProvider && 'border-destructive')}
                >
                  <span className="flex items-center gap-2">
                    {(() => {
                      const pKey = form.chatProvider || form.embeddingProvider || 'openai';
                      const meta = PROVIDER_META[pKey as keyof typeof PROVIDER_META];
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
                    const meta = PROVIDER_META[key as keyof typeof PROVIDER_META];
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
                    <SelectItem key={`custom:${cfg.modelName}`} value="custom">
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

          <div className="space-y-1.5">
            <Label className="text-xs">Model</Label>
            <Select
              value={isOtherChat ? 'other' : form.chatModelId || ''}
              onValueChange={(v: string | null) => {
                if (!v) return;
                if (v === 'other') {
                  setIsOtherChat(true);
                  return;
                }
                setIsOtherChat(false);
                setForm({ ...form, chatModelId: v });
              }}
            >
              <SelectTrigger className="w-full">
                <span className="truncate">{form.chatModelId || 'Default'}</span>
              </SelectTrigger>
              <SelectContent className="max-h-[320px]">
                {chatStatus?.availableModels ? (
                  <SelectGroup>
                    {chatStatus.availableModels.map((m: any) => (
                      <SelectItem key={m.id} value={m.id}>
                        <span>{m.label}</span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ) : (
                  <div className="p-2 text-sm text-muted-foreground">Loading models...</div>
                )}
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
                        <span>{m.modelName}</span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                <SelectGroup>
                  <SelectItem value="other" className="pl-8">
                    Other...
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            {isOtherChat && (
              <Input
                placeholder="Enter custom model ID"
                value={form.chatModelId || ''}
                onChange={(e) => setForm({ ...form, chatModelId: e.target.value })}
                className="mt-2"
              />
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">API Key</Label>
            <div className="relative">
              <Input
                type={showChatKey ? 'text' : 'password'}
                value={form.chatApiKey || ''}
                onChange={(e) => {
                  setForm({ ...form, chatApiKey: e.target.value });
                  clearError('chatApiKey');
                }}
                placeholder="sk-..."
                className={cn('pr-10', errors.chatApiKey && 'border-destructive')}
              />
              <button
                type="button"
                onClick={() => setShowChatKey(!showChatKey)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
              >
                {showChatKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex justify-end pt-4 border-t">
          <Button
            size="sm"
            disabled={saving === 'chat' || !dirtyChat}
            onClick={() => handleSave('chat')}
            className="gap-1.5"
          >
            {saving === 'chat' ? (
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
