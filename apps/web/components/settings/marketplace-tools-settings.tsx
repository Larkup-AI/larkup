'use client';

import { useState, useEffect } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Loader2, Save, Store, Eye, EyeOff, CheckCircle2, XCircle } from 'lucide-react';
import type { RagConfig } from '@larkup/core/types';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function MarketplaceToolsSettings() {
  const {
    data: marketplaceData,
    isLoading: toolsLoading,
    error: toolsError,
  } = useSWR('/api/marketplace', fetcher);
  const {
    data: configData,
    mutate: mutateConfig,
    isLoading: configLoading,
    error: configError,
  } = useSWR<{ config: RagConfig }>('/api/config', fetcher);

  const [form, setForm] = useState<{ toolConfigs: Record<string, any> }>({ toolConfigs: {} });
  const [saving, setSaving] = useState<string | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [verifyStatus, setVerifyStatus] = useState<
    Record<string, { status: 'success' | 'error' | null; message?: string }>
  >({});
  const [showToolKeys, setShowToolKeys] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (configData?.config?.toolConfigs) {
      setForm({ toolConfigs: configData.config.toolConfigs });
    }
  }, [configData]);

  if (toolsError || configError) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <XCircle className="h-6 w-6 text-destructive mb-4" />
        <h3 className="text-lg font-medium text-destructive">Failed to load configuration</h3>
        <p className="text-sm text-muted-foreground mt-1">Please try refreshing the page.</p>
      </div>
    );
  }

  if (toolsLoading || configLoading || !marketplaceData || !configData) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="size-5 text-muted-foreground animate-spin" />
      </div>
    );
  }

  const installedTools =
    marketplaceData?.tools?.filter(
      (t: any) => t.status === 'installed' && t.configSchema?.length > 0,
    ) || [];

  if (installedTools.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <Store className="h-6 w-6 text-primary" />
        </div>
        <h3 className="mb-2 text-lg font-semibold">No Tools Installed</h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          You haven't installed any Marketplace tools that require configuration yet.
        </p>
      </div>
    );
  }

  async function handleSave(toolId: string) {
    setSaving(toolId);
    try {
      const currentConfig = configData?.config || {};
      const newConfig = {
        ...currentConfig,
        toolConfigs: form.toolConfigs,
      };

      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig),
      });

      if (!res.ok) throw new Error('Failed to save configuration');

      await mutateConfig();
      toast.success('Tool configuration saved successfully');
    } catch (err: any) {
      toast.error(err.message || 'An error occurred while saving');
    } finally {
      setSaving(null);
    }
  }

  async function handleVerify(toolId: string) {
    setVerifying(toolId);
    setVerifyStatus((prev) => ({ ...prev, [toolId]: { status: null } }));

    try {
      if (toolId === 'video-audio') {
        const audioProvider = form.toolConfigs['video-audio']?.audioProvider;
        const audioApiKey = form.toolConfigs['video-audio']?.audioApiKey || '';

        if (!audioProvider) {
          throw new Error('Choose an Audio Provider before verifying this tool.');
        }

        const res = await fetch('/api/config/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audioProvider, audioApiKey }),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Verification failed');
        }
      } else {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      setVerifyStatus((prev) => ({ ...prev, [toolId]: { status: 'success' } }));
      toast.success('Configuration verified successfully');
    } catch (err: any) {
      setVerifyStatus((prev) => ({ ...prev, [toolId]: { status: 'error', message: err.message } }));
      toast.error(err.message || 'Verification failed');
    } finally {
      setVerifying(null);
    }
  }

  const getProviderIcon = (provider: string) => {
    switch (provider) {
      case 'openai':
        return '/icons/openai.svg';
      case 'google':
        return '/icons/gemini.svg';
      case 'deepgram':
        return '/icons/deepgram.png';
      case 'elevenlabs':
        return '/icons/elevenlabs.png';
      case 'groq':
        return '/icons/grok.png';
      case 'local':
        return '/icons/audio.png';
      default:
        return '/icons/audio.png';
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-medium tracking-tight">Marketplace Tools</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Configure API keys and settings for your installed tools.
        </p>
      </div>

      <div className="grid gap-6">
        {installedTools.map((tool: any) => {
          const isToolDirty =
            JSON.stringify(form.toolConfigs?.[tool.id] || {}) !==
            JSON.stringify(configData?.config?.toolConfigs?.[tool.id] || {});
          const vStatus = verifyStatus[tool.id];

          return (
            <Card
              key={tool.id}
              className="overflow-hidden transition-all  border border-border bg-white"
            >
              <CardHeader className=" pb-4 gap-0 ">
                <CardTitle className="flex items-center gap-3 text-base">
                  <div className="flex h-8 w-8 mt-1  items-center justify-center rounded-md bg-background border border-border/50">
                    <img
                      src={`/icons/${tool.id === 'video-audio' ? 'video' : 'webhook'}.png`}
                      alt={tool.name}
                      className="h-5 w-5 object-contain"
                      onError={(e) => {
                        e.currentTarget.src = '/icons/audio.png';
                      }}
                    />
                  </div>
                  {tool.name}
                </CardTitle>
                <CardDescription className="text-xs pt-0 ml-11">{tool.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5 ">
                {vStatus?.status === 'error' && (
                  <div className="rounded-md bg-destructive/10 p-3 flex gap-2 items-start border border-destructive/20 text-destructive text-sm">
                    <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>{vStatus.message}</span>
                  </div>
                )}
                {vStatus?.status === 'success' && (
                  <div className="rounded-md bg-emerald-500/10 p-3 flex gap-2 items-start border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-sm">
                    <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>Connection verified successfully.</span>
                  </div>
                )}

                {tool.configSchema.map((schema: any) => {
                  let value = form.toolConfigs?.[tool.id]?.[schema.key];

                  if (
                    value === undefined &&
                    schema.key === 'audioProvider' &&
                    tool.id === 'video-audio'
                  ) {
                    value = '';
                  } else if (value === undefined) {
                    value = schema.defaultValue ?? '';
                  }

                  const isShowKey = showToolKeys[`${tool.id}_${schema.key}`];

                  let currentLabel = schema.label;
                  if (schema.key === 'audioApiKey' && tool.id === 'video-audio') {
                    const currentProvider = form.toolConfigs?.[tool.id]?.audioProvider || '';

                    if (currentProvider === 'local') return null;

                    const providerOpt = tool.configSchema
                      .find((s: any) => s.key === 'audioProvider')
                      ?.options?.find((o: any) => o.value === currentProvider);
                    currentLabel = providerOpt ? `${providerOpt.label} API Key` : schema.label;
                  }

                  return (
                    <div key={schema.key} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-[13px] font-medium">{currentLabel}</Label>
                        {schema.key === 'audioApiKey' && vStatus?.status === 'success' && (
                          <span className="text-[10px] text-emerald-500 font-medium">
                            ✓ Verified
                          </span>
                        )}
                        {schema.key === 'audioApiKey' && vStatus?.status === 'error' && (
                          <span className="text-[10px] text-destructive font-medium truncate max-w-[150px]">
                            {vStatus.message}
                          </span>
                        )}
                      </div>
                      {schema.type === 'select' ? (
                        <Select
                          value={value || ''}
                          onValueChange={(v) => {
                            if (v === 'local') {
                              toast('Coming Soon', {
                                description: 'Local Whisper support is currently in development.',
                              });
                              return;
                            }
                            setForm({
                              ...form,
                              toolConfigs: {
                                ...form.toolConfigs,
                                [tool.id]: {
                                  ...(form.toolConfigs?.[tool.id] || {}),
                                  [schema.key]: v,
                                },
                              },
                            });
                            setVerifyStatus((prev) => ({ ...prev, [tool.id]: { status: null } }));
                          }}
                        >
                          <SelectTrigger className="w-full h-9">
                            <div className="flex items-center gap-2">
                              {schema.key === 'audioProvider' && (
                                <img
                                  src={getProviderIcon(value)}
                                  className="w-4 h-4 object-contain opacity-80"
                                  alt=""
                                />
                              )}
                              <span>
                                {schema.options?.find((o: any) => o.value === value)?.label ||
                                  value ||
                                  'Choose a provider'}
                              </span>
                            </div>
                          </SelectTrigger>
                          <SelectContent>
                            {schema.options?.map((opt: any) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                <div className="flex items-center gap-2">
                                  {schema.key === 'audioProvider' && (
                                    <img
                                      src={getProviderIcon(opt.value)}
                                      className="w-4 h-4 object-contain"
                                      alt=""
                                    />
                                  )}
                                  <span
                                    className={opt.value === 'local' ? 'text-muted-foreground' : ''}
                                  >
                                    {opt.label}
                                    {opt.value === 'local' && ' (Coming soon)'}
                                  </span>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : schema.type === 'password' ? (
                        <div className="flex gap-2">
                          <div className="relative flex-1">
                            <Input
                              type={isShowKey ? 'text' : 'password'}
                              value={value}
                              onChange={(e) => {
                                setForm({
                                  ...form,
                                  toolConfigs: {
                                    ...form.toolConfigs,
                                    [tool.id]: {
                                      ...(form.toolConfigs?.[tool.id] || {}),
                                      [schema.key]: e.target.value,
                                    },
                                  },
                                });
                                setVerifyStatus((prev) => ({
                                  ...prev,
                                  [tool.id]: { status: null },
                                }));
                              }}
                              placeholder={schema.placeholder || 'sk-...'}
                              className="pr-10 h-9 font-mono text-sm"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                setShowToolKeys({
                                  ...showToolKeys,
                                  [`${tool.id}_${schema.key}`]: !isShowKey,
                                })
                              }
                              className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
                            >
                              {isShowKey ? (
                                <EyeOff className="size-4" />
                              ) : (
                                <Eye className="size-4" />
                              )}
                            </button>
                          </div>
                          {schema.key === 'audioApiKey' && tool.id === 'video-audio' && (
                            <Button
                              className="rounded-md h-9"
                              variant="outline"
                              size="default"
                              onClick={() => handleVerify(tool.id)}
                              disabled={verifying === tool.id || !value}
                            >
                              {verifying === tool.id ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : (
                                'Verify'
                              )}
                            </Button>
                          )}
                        </div>
                      ) : (
                        <Input
                          type="text"
                          value={value}
                          onChange={(e) => {
                            setForm({
                              ...form,
                              toolConfigs: {
                                ...form.toolConfigs,
                                [tool.id]: {
                                  ...(form.toolConfigs?.[tool.id] || {}),
                                  [schema.key]: e.target.value,
                                },
                              },
                            });
                            setVerifyStatus((prev) => ({ ...prev, [tool.id]: { status: null } }));
                          }}
                          placeholder={schema.placeholder}
                          className="h-9"
                        />
                      )}
                      {schema.help && (
                        <p className="text-[11px] text-muted-foreground">{schema.help}</p>
                      )}
                    </div>
                  );
                })}
              </CardContent>
              <CardFooter className="flex justify-end gap-2 pt-4 pb-4 border-t bg-muted/10">
                <Button
                  size="sm"
                  disabled={saving === tool.id || !isToolDirty}
                  onClick={() => handleSave(tool.id)}
                  className="gap-1.5 min-w-[80px]"
                >
                  {saving === tool.id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Save className="size-3.5" />
                  )}
                  Save
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
