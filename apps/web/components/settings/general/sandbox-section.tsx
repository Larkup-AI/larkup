'use client';

import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import {
  Loader2,
  Save,
  Eye,
  EyeOff,
  AlertTriangle,
  ExternalLink,
  CircleAlert,
  CircleCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import type { RagConfig } from '@larkup/core/types';
import { SANDBOX_PROVIDER_LIST, getSandboxProvider } from '@larkup/sandbox/registry';
import type { SandboxBackend } from '@larkup/sandbox/types';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import Image from 'next/image';

const fetcher = (url: string) => fetch(url).then((r) => r.json() as Promise<{ config: RagConfig }>);
type SandboxStatus = { provider: SandboxBackend; status: 'ready' | 'unavailable'; message: string };
const localSandbox = { label: 'Local Sandbox' };
const defaultLocalSandboxIcon = '/icons/linux.png';
let cachedLocalSandboxIcon: string | undefined;

function getLocalSandboxIcon() {
  if (cachedLocalSandboxIcon) return cachedLocalSandboxIcon;

  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.userAgent;
  cachedLocalSandboxIcon = /windows/i.test(platform)
    ? '/icons/windows.png'
    : /mac|iphone|ipad|ipod/i.test(platform)
    ? '/icons/mac.png'
    : defaultLocalSandboxIcon;
  return cachedLocalSandboxIcon;
}

export function SandboxSection({
  embedded = false,
  onProviderChange,
  children,
}: {
  embedded?: boolean;
  onProviderChange?: (provider: SandboxBackend) => void;
  children?: React.ReactNode;
}) {
  const { data, isLoading, mutate } = useSWR('/api/config', fetcher);
  const { data: sandboxStatus, mutate: mutateSandboxStatus } = useSWR<SandboxStatus>(
    '/api/sandbox/verify',
    (url) => fetch(url).then((r) => r.json()),
    { revalidateOnFocus: false },
  );
  const [form, setForm] = useState<Partial<RagConfig>>({});
  const [provider, setProvider] = useState<SandboxBackend>('local');
  const [localSandboxIcon, setLocalSandboxIcon] = useState(defaultLocalSandboxIcon);
  const [saving, setSaving] = useState(false);
  const [showSecrets, setShowSecrets] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState<{
    status: 'success' | 'error' | null;
    message?: string;
  }>({ status: null });
  const migratedLegacyDocker = useRef(false);

  useEffect(() => {
    setLocalSandboxIcon(getLocalSandboxIcon());
  }, []);

  useEffect(() => {
    if (data?.config) {
      setForm(data.config);
      const defaultProv = (data.config.defaultSandboxProvider as SandboxBackend) || 'local';
      setProvider(defaultProv);
      onProviderChange?.(defaultProv);
    }
  }, [data]);

  useEffect(() => {
    if (
      migratedLegacyDocker.current ||
      data?.config.defaultSandboxProvider !== 'docker' ||
      sandboxStatus?.provider !== 'docker' ||
      sandboxStatus.status === 'ready'
    ) {
      return;
    }
    migratedLegacyDocker.current = true;
    void fetch('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data.config, defaultSandboxProvider: 'local' }),
    })
      .then(async (response) => {
        if (!response.ok) return;
        const json = (await response.json()) as { config: RagConfig };
        setForm(json.config);
        setProvider('local');
        onProviderChange?.('local');
        await mutate(json, { revalidate: false });
        await mutateSandboxStatus();
      })
      .catch(() => {
        migratedLegacyDocker.current = false;
      });
  }, [data, mutate, mutateSandboxStatus, onProviderChange, sandboxStatus]);

  const descriptor = getSandboxProvider(provider);
  const values = form.sandboxProviderConfigs?.[provider] ?? {};

  const dirty =
    provider !== ((data?.config?.defaultSandboxProvider as SandboxBackend) || 'local') ||
    JSON.stringify(values) !==
      JSON.stringify(data?.config?.sandboxProviderConfigs?.[provider] ?? {});

  function setFieldValue(key: string, value: string) {
    setVerifyStatus({ status: null });
    setForm((prev) => ({
      ...prev,
      sandboxProviderConfigs: {
        ...prev.sandboxProviderConfigs,
        [provider]: { ...prev.sandboxProviderConfigs?.[provider], [key]: value },
      },
    }));
  }

  async function verifySandbox(showSuccessToast: boolean) {
    setVerifying(true);
    setVerifyStatus({ status: null });
    try {
      const res = await fetch('/api/sandbox/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, credentials: values }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Verification failed');

      setVerifyStatus({ status: 'success' });
      await mutateSandboxStatus();
      if (showSuccessToast) {
        toast.success(
          `${
            descriptor?.label ?? (provider === 'docker' ? 'Local Docker' : localSandbox.label)
          } credentials verified!`,
          { position: 'top-right' },
        );
      }
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Verification failed';
      setVerifyStatus({ status: 'error', message: msg });
      toast.error(msg, { position: 'top-right' });
      return false;
    } finally {
      setVerifying(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      if (!(await verifySandbox(false))) return;

      const payload: RagConfig = {
        ...(data?.config as RagConfig),
        defaultSandboxProvider: provider,
        sandboxProviderConfigs: form.sandboxProviderConfigs ?? {},
      };
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to save');

      setForm((prev) => ({ ...prev, ...json.config }));
      await mutate(json, { revalidate: false });
      await mutateSandboxStatus();
      toast.success('Sandbox settings saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function handleVerify() {
    await verifySandbox(true);
  }

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const providerCard = (
    <Card className="bg-white/70 dark:bg-card/70">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Code execution</CardTitle>
        <CardDescription className="text-xs">
          Choose where code-enabled Assistant tools run, and verify any provider credentials here.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {(() => {
          const isCurrent = sandboxStatus?.provider === provider;
          const isReady = sandboxStatus?.status === 'ready';
          return (
            <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-xs">
              {isReady ? (
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
              ) : (
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
              )}
              <div>
                <p className="font-medium">
                  {isCurrent
                    ? isReady
                      ? 'Current sandbox is ready'
                      : 'Current sandbox needs attention'
                    : 'Save to select this sandbox'}
                </p>
                <p className="mt-0.5 text-muted-foreground">
                  {isCurrent
                    ? sandboxStatus.message
                    : `${
                        provider === 'local'
                          ? localSandbox.label
                          : provider === 'docker'
                          ? 'Local Docker'
                          : descriptor?.label ?? provider
                      } is not active yet.`}
                </p>
              </div>
            </div>
          );
        })()}
        <div className="space-y-1.5">
          <Label className="text-xs">Provider</Label>
          <Select
            value={provider}
            onValueChange={(value) => {
              const p = value as SandboxBackend;
              setProvider(p);
              onProviderChange?.(p);
              setVerifyStatus({ status: null });
            }}
          >
            <SelectTrigger className="w-full">
              <div className="flex items-center gap-2">
                <Image
                  src={
                    descriptor?.icon ?? (provider === 'local' ? localSandboxIcon : '/docker.png')
                  }
                  alt=""
                  width={16}
                  height={16}
                />
                <SelectValue placeholder="Select provider">
                  {(value: string) =>
                    value === 'local'
                      ? localSandbox.label
                      : value === 'docker'
                      ? 'Local Docker'
                      : descriptor?.label ?? value
                  }
                </SelectValue>
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="local">
                <div className="flex items-center gap-2">
                  <Image src={localSandboxIcon} alt="Local Sandbox" width={16} height={16} />
                  <span>{localSandbox.label}</span>
                </div>
              </SelectItem>
              <SelectItem value="docker">
                <div className="flex items-center gap-2">
                  <Image src="/docker.png" alt="Docker" width={16} height={16} />
                  <span>Local Docker</span>
                </div>
              </SelectItem>
              {SANDBOX_PROVIDER_LIST.filter((p) => p.executionSupport === 'full').map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  <div className="flex items-center gap-2">
                    <Image src={p.icon} alt={p.label} width={16} height={16} />
                    <span>{p.label}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {provider === 'local' && (
            <p className="pt-1 text-xs text-muted-foreground">
              Runs trusted Python or JavaScript on this computer. No Docker or credentials needed.
            </p>
          )}
          {provider === 'docker' && (
            <p className="pt-1 text-xs text-muted-foreground">
              Runs in a local Docker container. No credentials required — requires Docker to be
              installed and running.
            </p>
          )}
        </div>

        {descriptor && descriptor.executionSupport === 'unsupported' && (
          <Alert>
            <AlertTriangle className="size-4 text-amber-500" />
            <AlertDescription>{descriptor.executionCaveat}</AlertDescription>
          </Alert>
        )}

        {descriptor && descriptor.fields.length > 0 && (
          <div className="space-y-4 pt-2">
            <Label className="text-xs">{descriptor.label} credentials</Label>

            <div className="flex items-center gap-1">
              <div className="w-full">
                {descriptor.fields.map((field, index) => (
                  <div key={field.key} className="space-y-1.5">
                    <Label className="text-xs" htmlFor={`sandbox-${provider}-${field.key}`}>
                      {field.label}
                      {field.required && <span className="text-destructive"> *</span>}
                    </Label>
                    <div className="relative">
                      <Input
                        id={`sandbox-${provider}-${field.key}`}
                        type={field.type === 'password' && !showSecrets ? 'password' : 'text'}
                        className={field.type === 'password' ? 'text-sm pr-9' : 'text-sm'}
                        value={values[field.key] ?? ''}
                        onChange={(e) => setFieldValue(field.key, e.target.value)}
                        placeholder={field.placeholder}
                      />
                      {field.type === 'password' && (
                        <button
                          type="button"
                          onClick={() => setShowSecrets(!showSecrets)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          aria-label={showSecrets ? 'Hide secret' : 'Show secret'}
                        >
                          {showSecrets ? (
                            <EyeOff className="size-3.5" />
                          ) : (
                            <Eye className="size-3.5" />
                          )}
                        </button>
                      )}
                    </div>
                    {field.help && (
                      <div className="flex items-center justify-start gap-2">
                        <p className="text-[11px] text-muted-foreground">{field.help}</p>
                        {index === 0 && (
                          <a
                            href={descriptor.docsUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex underline shrink-0 items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                          >
                            Docs <ExternalLink className="size-3" />
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {verifyStatus.status === 'success' && (
          <p className="text-[11px] font-medium text-green-600">✓ Credentials verified</p>
        )}
        {verifyStatus.status === 'error' && (
          <p className="text-[11px] font-medium text-red-500">{verifyStatus.message}</p>
        )}

        {children}
      </CardContent>
      <CardFooter className="flex justify-end gap-2 border-t pt-4">
        <Button variant="outline" size="lg" onClick={handleVerify} disabled={verifying}>
          {verifying ? <Loader2 className="size-3.5 animate-spin" /> : null}
          Verify
        </Button>
        <Button
          size="lg"
          disabled={saving || verifying || !dirty}
          onClick={handleSave}
          className="gap-1.5 px-4"
        >
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          Save sandbox settings
        </Button>
      </CardFooter>
    </Card>
  );

  if (embedded) return providerCard;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Code Execution Sandbox</h2>
          <p className="text-sm text-muted-foreground">
            Choose where Assistant tools that run code (e.g. data analysis, corpus analytics)
            execute, and connect the provider&apos;s credentials.
          </p>
        </div>
      </div>

      {providerCard}
    </div>
  );
}
