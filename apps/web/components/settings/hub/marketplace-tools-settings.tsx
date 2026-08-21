'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { CheckCircle2, CircleHelp, Eye, EyeOff, Loader2, Save, Store, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import type { RagConfig } from '@larkup/core/types';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

type ConfigField = {
  key: string;
  label: string;
  type: 'text' | 'password' | 'select' | 'toggle';
  defaultValue?: string;
  help?: string;
  required?: boolean;
  options?: { label: string; value: string; description?: string; icon?: string; image?: string }[];
  group?: string;
  verification?: { endpoint: string; method?: 'POST' | 'PUT'; fields?: Record<string, string> };
  layout?: 'full' | 'half';
};
type InstalledTool = {
  id: string;
  name: string;
  description: string;
  emoji?: string;
  status: 'available' | 'installed';
  configSchema?: ConfigField[];
};
const fetcher = (url: string) => fetch(url).then((res) => res.json());

function OptionDescription({ description }: { description?: string }) {
  if (!description) return null;
  if (description.length <= 56)
    return <span className="text-xs text-muted-foreground">{description}</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Show option description"
          className="text-muted-foreground hover:text-foreground"
        >
          <CircleHelp className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{description}</TooltipContent>
    </Tooltip>
  );
}

function groupConfigFields(fields: ConfigField[]) {
  const groups = new Map<string, ConfigField[]>();
  for (const field of fields) {
    const key = field.group ?? '';
    groups.set(key, [...(groups.get(key) ?? []), field]);
  }
  return [...groups.entries()];
}

export function MarketplaceToolsSettings({ embedded = false }: { embedded?: boolean }) {
  const {
    data: marketplaceData,
    isLoading: toolsLoading,
    error: toolsError,
  } = useSWR<{ tools: InstalledTool[] }>('/api/marketplace', fetcher);
  const {
    data: configData,
    mutate: mutateConfig,
    isLoading: configLoading,
    error: configError,
  } = useSWR<{ config: RagConfig }>('/api/config', fetcher);
  const [form, setForm] = useState<Record<string, Record<string, string | boolean>>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [verifyStatus, setVerifyStatus] = useState<
    Record<string, { status: 'success' | 'error'; message?: string } | undefined>
  >({});
  const [visibleSecrets, setVisibleSecrets] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (configData?.config.toolConfigs) setForm(configData.config.toolConfigs);
  }, [configData]);
  const installedTools = (marketplaceData?.tools ?? []).filter(
    (tool) => tool.status === 'installed' && tool.configSchema?.length,
  );
  const valueFor = (tool: InstalledTool, field: ConfigField) =>
    form[tool.id]?.[field.key] ??
    (field.type === 'toggle' ? field.defaultValue === 'true' : field.defaultValue ?? '');
  function update(toolId: string, key: string, value: string | boolean) {
    setForm((current) => ({ ...current, [toolId]: { ...current[toolId], [key]: value } }));
    setVerifyStatus((current) => ({ ...current, [toolId]: undefined }));
  }
  async function save(toolId: string) {
    if (!configData?.config) return;
    setSaving(toolId);
    try {
      const response = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...configData.config, toolConfigs: form }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Could not save tool settings.');
      await mutateConfig(result, { revalidate: false });
      toast.success('Tool configuration saved successfully.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save tool settings.');
    } finally {
      setSaving(null);
    }
  }
  async function verify(tool: InstalledTool, field: ConfigField) {
    setVerifying(tool.id);
    setVerifyStatus((current) => ({ ...current, [tool.id]: undefined }));
    try {
      const verification = field.verification;
      if (!verification) return;
      const payload = Object.fromEntries(
        Object.entries(verification.fields ?? { [field.key]: '$value' }).map(
          ([requestKey, configKey]) => [
            requestKey,
            String(
              valueFor(
                tool,
                configKey === '$value'
                  ? field
                  : tool.configSchema?.find((candidate) => candidate.key === configKey) ?? field,
              ),
            ),
          ],
        ),
      );
      const response = await fetch(verification.endpoint, {
        method: verification.method ?? 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Verification failed.');
      setVerifyStatus((current) => ({ ...current, [tool.id]: { status: 'success' } }));
      toast.success('Connection verified successfully.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Verification failed.';
      setVerifyStatus((current) => ({ ...current, [tool.id]: { status: 'error', message } }));
      toast.error(message);
    } finally {
      setVerifying(null);
    }
  }

  if (toolsError || configError)
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <XCircle className="mb-4 size-6 text-destructive" />
        <h3 className="text-lg font-medium text-destructive">Failed to load configuration</h3>
        <p className="mt-1 text-sm text-muted-foreground">Please try refreshing the page.</p>
      </div>
    );
  if (toolsLoading || configLoading || !marketplaceData || !configData)
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  if (!installedTools.length)
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-primary/10">
          <Store className="size-6 text-primary" />
        </div>
        <h3 className="mb-2 text-lg font-semibold">No configurable tools installed</h3>
        <p className="max-w-sm text-sm text-muted-foreground">
          Install a Marketplace tool with settings to configure it here.
        </p>
      </div>
    );

  return (
    <div className="space-y-6">
      {!embedded && (
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Installed Tools</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure the options declared by each installed tool.
          </p>
        </div>
      )}
      <div className="grid gap-6">
        {installedTools.map((tool) => {
          const fields = tool.configSchema ?? [];
          const dirty =
            JSON.stringify(form[tool.id] ?? {}) !==
            JSON.stringify(configData.config.toolConfigs?.[tool.id] ?? {});
          const status = verifyStatus[tool.id];
          const groups = groupConfigFields(fields);
          return (
            <Card
              key={tool.id}
              className="overflow-hidden border bg-white shadow-none dark:bg-card"
            >
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-3 text-base">
                  <span className="flex size-9 items-center justify-center rounded-lg border bg-muted/40 text-lg">
                    {tool.emoji ?? '🔧'}
                  </span>
                  {tool.name}
                </CardTitle>
                <CardDescription className="ml-12 text-xs">{tool.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {status && (
                  <div
                    className={
                      status.status === 'success'
                        ? 'flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-400'
                        : 'flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive'
                    }
                  >
                    {status.status === 'success' ? (
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                    ) : (
                      <XCircle className="mt-0.5 size-4 shrink-0" />
                    )}
                    <span>
                      {status.status === 'success'
                        ? 'Connection verified successfully.'
                        : status.message}
                    </span>
                  </div>
                )}
                <div className="space-y-6">
                  {groups.map(([group, groupFields], groupIndex) => (
                    <section
                      key={group || `default-${groupIndex}`}
                      className={groupIndex === 0 ? '' : 'border-t pt-5'}
                    >
                      {group && <h2 className="mb-4 text-sm font-medium">{group}</h2>}
                      <div className="grid gap-x-5 gap-y-5 md:grid-cols-2">
                        {groupFields.map((field) => {
                          const value = valueFor(tool, field);
                          const secretId = `${tool.id}:${field.key}`;
                          const show = visibleSecrets[secretId];
                          const fullWidth =
                            field.layout === 'full' ||
                            (field.layout !== 'half' && groupFields.length === 1);
                          return (
                            <div
                              key={field.key}
                              className={fullWidth ? 'space-y-2 md:col-span-2' : 'space-y-2'}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <Label htmlFor={secretId} className="text-[13px] font-medium">
                                  {field.label}
                                  {field.required && (
                                    <span className="ml-1 text-destructive">*</span>
                                  )}
                                </Label>
                                {field.type === 'toggle' && (
                                  <Switch
                                    id={secretId}
                                    checked={Boolean(value)}
                                    onCheckedChange={(checked) =>
                                      update(tool.id, field.key, checked)
                                    }
                                  />
                                )}
                              </div>
                              {field.type === 'select' ? (
                                <Select
                                  value={String(value)}
                                  onValueChange={(next) => next && update(tool.id, field.key, next)}
                                >
                                  <SelectTrigger id={secretId} className="w-full">
                                    <div className="flex min-w-0 items-center gap-2">
                                      <SelectValue
                                        placeholder={`Choose ${field.label.toLowerCase()}`}
                                      />
                                    </div>
                                  </SelectTrigger>
                                  <SelectContent>
                                    {field.options?.map((option) => (
                                      <SelectItem key={option.value} value={option.value}>
                                        <span className="flex min-w-0 items-center gap-2">
                                          {(option.image ?? option.icon) && (
                                            <img
                                              src={option.image ?? option.icon}
                                              alt=""
                                              className="size-4 shrink-0 object-contain"
                                            />
                                          )}
                                          <span className="min-w-0">
                                            <span className="block">{option.label}</span>
                                            <OptionDescription description={option.description} />
                                          </span>
                                        </span>
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              ) : field.type === 'toggle' ? null : (
                                <div className="flex gap-2">
                                  <div className="relative min-w-0 flex-1">
                                    <Input
                                      id={secretId}
                                      type={
                                        field.type === 'password' && !show ? 'password' : 'text'
                                      }
                                      value={String(value)}
                                      onChange={(event) =>
                                        update(tool.id, field.key, event.target.value)
                                      }
                                      placeholder={
                                        field.type === 'password'
                                          ? 'Enter secret…'
                                          : field.defaultValue
                                      }
                                      className={
                                        field.type === 'password' ? 'pr-10 font-mono text-xs' : ''
                                      }
                                    />
                                    {field.type === 'password' && (
                                      <button
                                        type="button"
                                        aria-label={
                                          show ? `Hide ${field.label}` : `Show ${field.label}`
                                        }
                                        className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                                        onClick={() =>
                                          setVisibleSecrets((current) => ({
                                            ...current,
                                            [secretId]: !show,
                                          }))
                                        }
                                      >
                                        {show ? (
                                          <EyeOff className="size-4" />
                                        ) : (
                                          <Eye className="size-4" />
                                        )}
                                      </button>
                                    )}
                                  </div>
                                  {field.verification && (
                                    <Button
                                      variant="outline"
                                      size="default"
                                      className={'h-10 px-5'}
                                      onClick={() => void verify(tool, field)}
                                      disabled={!value || verifying === tool.id}
                                    >
                                      {verifying === tool.id ? (
                                        <Loader2 className="size-4 animate-spin" />
                                      ) : (
                                        'Verify'
                                      )}
                                    </Button>
                                  )}
                                </div>
                              )}
                              {field.help && (
                                <p className="text-[11px] leading-relaxed text-muted-foreground">
                                  {field.help}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              </CardContent>
              <CardFooter className="justify-end border-t bg-muted/10">
                <Button
                  size="sm"
                  disabled={!dirty || saving === tool.id}
                  onClick={() => void save(tool.id)}
                >
                  {saving === tool.id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Save className="size-3.5" />
                  )}
                  Save settings
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
