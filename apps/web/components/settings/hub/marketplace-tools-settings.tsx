'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import {
  Check,
  CheckCircle2,
  CircleHelp,
  Copy,
  Download,
  Eye,
  EyeOff,
  Loader2,
  Play,
  Save,
  Square,
  Store,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import type { RagConfig } from '@larkup/core/types';
import { useProject } from '@/components/projects/project-provider';
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
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { GenericAlert } from '@/components/alerts/generic-alert';

type ConfigField = {
  key: string;
  label: string;
  type: 'text' | 'password' | 'select' | 'toggle';
  defaultValue?: string;
  help?: string;
  required?: boolean;
  options?: { label: string; value: string; description?: string; icon?: string; image?: string }[];
  providerField?: string;
  defaultValueByProvider?: Record<string, string>;
  defaultFromGlobalConfigKey?: 'visionProvider' | 'chatProvider';
  group?: string;
  verification?: { endpoint: string; method?: 'POST' | 'PUT'; fields?: Record<string, string> };
  layout?: 'full' | 'half';
  visibleWhen?: { field: string; equals: string | boolean | Array<string | boolean> };
  serverManaged?: boolean;
  readOnly?: boolean;
};
type RuntimeMode = {
  id: 'local' | 'local-docker' | 'local-process' | 'managed-cloud' | 'custom-remote';
  label: string;
  description: string;
  endpointConfigKey?: string;
  credentialConfigKey?: string;
  icon?: string;
  image?: string;
  composeFile?: string;
  setupNotice?: string;
};
type InstalledTool = {
  id: string;
  name: string;
  description: string;
  emoji?: string;
  status: 'available' | 'installed';
  configSchema?: ConfigField[];
  usage?: {
    label?: string;
    fields: { key: string; label: string; format?: 'number' | 'minutes' }[];
    visibleWhenRuntimeMode?: RuntimeMode['id'][];
    visualization?: { usedKey: string; limitKey: string };
    support?: { contactLabel?: string; description?: string; userIdConfigKey?: string };
  };
  runtime?: { defaultMode: RuntimeMode['id']; modes: RuntimeMode[] };
};
const fetcher = (url: string) => fetch(url).then((res) => res.json());

const usageFetcher = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Usage is unavailable.');
  return (await response.json()) as Record<string, unknown>;
};

function OptionDescription({ description }: { description?: string }) {
  if (!description) return null;
  if (description.length <= 56)
    return <span className="text-xs text-muted-foreground">{description}</span>;
  return (
    <Tooltip>
      <TooltipTrigger
        className="text-muted-foreground hover:text-foreground"
        aria-label="Show option description"
      >
        <CircleHelp className="size-3.5" />
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

function isVisible(
  tool: InstalledTool,
  field: ConfigField,
  form: Record<string, Record<string, string | boolean>>,
) {
  if (!field.visibleWhen) return true;
  const controllingField = tool.configSchema?.find(
    (candidate) => candidate.key === field.visibleWhen?.field,
  );
  if (controllingField && !isVisible(tool, controllingField, form)) return false;
  const value = form[tool.id]?.[field.visibleWhen.field] ?? controllingField?.defaultValue;
  const expected = Array.isArray(field.visibleWhen.equals)
    ? field.visibleWhen.equals
    : [field.visibleWhen.equals];
  return expected.some((candidate) => candidate === value);
}

function modelsForProvider(
  options: ConfigField['options'],
  provider: string,
): ConfigField['options'] {
  if (!options) return options;
  if (provider === 'google') return options.filter((option) => option.value.startsWith('google/'));
  if (provider === 'openai') return options.filter((option) => option.value.startsWith('openai/'));
  return options;
}

function ToolUsageSummary({
  tool,
  runtimeMode,
  toolConfig,
  serverId,
}: {
  tool: InstalledTool;
  runtimeMode: string;
  toolConfig: Record<string, string | boolean>;
  serverId?: string;
}) {
  const shouldShow =
    Boolean(tool.usage) &&
    (!tool.usage?.visibleWhenRuntimeMode ||
      tool.usage.visibleWhenRuntimeMode.includes(runtimeMode as RuntimeMode['id']));
  const usageQuery = new URLSearchParams({ runtimeMode });
  if (serverId) usageQuery.set('serverId', serverId);
  const { data, error } = useSWR<Record<string, unknown> | null>(
    shouldShow ? `/api/tools/${encodeURIComponent(tool.id)}/usage?${usageQuery}` : null,
    usageFetcher,
    { revalidateOnFocus: false },
  );
  const [requestOpen, setRequestOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  if (!shouldShow || !tool.usage) return null;
  const usageData = data ?? {};
  const visualization = tool.usage.visualization;
  const used = visualization ? usageData[visualization.usedKey] : undefined;
  const limit = visualization ? usageData[visualization.limitKey] : undefined;
  const ratio =
    typeof used === 'number' && typeof limit === 'number' && limit > 0
      ? Math.min(1, Math.max(0, used / limit))
      : null;
  const userId = tool.usage.support?.userIdConfigKey
    ? toolConfig[tool.usage.support.userIdConfigKey]
    : undefined;
  async function requestMoreAccess() {
    setSubmitting(true);
    try {
      const response = await fetch(
        `/api/tools/${encodeURIComponent(tool.id)}/usage-request${
          serverId ? `?serverId=${encodeURIComponent(serverId)}` : ''
        }`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, note, usage: usageData }),
        },
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not send the request.');
      toast.success('Your access request was sent.');
      setRequestOpen(false);
      setNote('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not send the request.');
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <>
      <div className="rounded-lg border bg-muted/20 px-3 py-3">
        <div className="flex items-center gap-3">
          {ratio !== null && typeof used === 'number' && typeof limit === 'number' && (
            <div
              className="relative grid size-14 shrink-0 place-items-center rounded-full"
              aria-label={`${Math.round(ratio * 100)} percent of monthly allowance used`}
            >
              <svg className="size-14 -rotate-90" viewBox="0 0 56 56" aria-hidden="true">
                <circle cx="28" cy="28" r="23" fill="none" stroke="var(--muted)" strokeWidth="5" />
                <circle
                  cx="28"
                  cy="28"
                  r="23"
                  fill="none"
                  stroke="var(--foreground)"
                  strokeLinecap="round"
                  strokeWidth="5"
                  style={{
                    strokeDasharray: `${2 * Math.PI * 23}`,
                    strokeDashoffset: `${2 * Math.PI * 23 * (1 - ratio)}`,
                    transition: 'stroke-dashoffset 500ms ease-out',
                  }}
                />
              </svg>
              <span className="pointer-events-none absolute text-[11px] font-semibold tabular-nums">
                {Math.round(ratio * 100)}%
              </span>
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {tool.usage.label ?? 'Usage'}
            </p>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums">
              {tool.usage.fields.map((field) => {
                const value = usageData[field.key];
                if (typeof value !== 'number') return null;
                const display =
                  field.format === 'minutes' ? `${value.toFixed(2)} min` : String(value);
                return (
                  <span key={field.key} className="text-muted-foreground">
                    {field.label} <span className="font-medium text-foreground">{display}</span>
                  </span>
                );
              })}
            </div>
            {error ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Usage is temporarily unavailable. Your cloud allowance has not changed.
              </p>
            ) : !data ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Usage appears once Cloud access is automatically provisioned. You can request more
                capacity below when needed.
              </p>
            ) : null}
          </div>
          {tool.usage.support && (
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 text-xs"
              onClick={() => setRequestOpen(true)}
            >
              {tool.usage.support.contactLabel ?? 'Request access'}
            </Button>
          )}
        </div>
      </div>
      <Dialog open={requestOpen} onOpenChange={setRequestOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tool.usage.support?.contactLabel ?? 'Request cloud access'}</DialogTitle>
            <DialogDescription>
              {tool.usage.support?.description ?? 'Send the Larkup team your usage details.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor={`${tool.id}-usage-email`}>Email</Label>
              <Input
                id={`${tool.id}-usage-email`}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${tool.id}-usage-note`}>Note (optional)</Label>
              <Textarea
                id={`${tool.id}-usage-note`}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Tell us how you plan to use the tool"
                className="min-h-[80px]"
              />
            </div>
            {typeof userId === 'string' && (
              <p className="text-xs text-muted-foreground">Your cloud user ID will be included.</p>
            )}
            <Button
              className="w-full"
              disabled={!email || submitting}
              onClick={() => void requestMoreAccess()}
            >
              {submitting ? 'Sending…' : 'Send request'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ToolRuntimeConnection({
  tool,
  mode,
  hasUnsavedChanges,
  runtimeConfig,
  serverId,
}: {
  tool: InstalledTool;
  mode: RuntimeMode;
  hasUnsavedChanges: boolean;
  runtimeConfig: Record<string, string | boolean>;
  serverId?: string;
}) {
  const [state, setState] = useState<{
    loading: boolean;
    error?: string;
    display?: Record<string, string>;
  }>({ loading: mode.id === 'managed-cloud' });
  const [copiedUserId, setCopiedUserId] = useState(false);
  useEffect(() => {
    if (mode.id !== 'managed-cloud') return;
    let cancelled = false;
    setState({ loading: true });
    const query = serverId ? `?serverId=${encodeURIComponent(serverId)}` : '';
    void fetch(`/api/tools/${encodeURIComponent(tool.id)}/runtime${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: runtimeConfig }),
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Could not connect this runtime.');
        if (!cancelled) setState({ loading: false, display: body.display });
      })
      .catch(
        (error) =>
          !cancelled &&
          setState({
            loading: false,
            error: error instanceof Error ? error.message : 'Could not connect this runtime.',
          }),
      );
    return () => {
      cancelled = true;
    };
  }, [mode.id, runtimeConfig, serverId, tool.id]);
  if (mode.id === 'managed-cloud') {
    if (state.loading)
      return (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2.5 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Connecting your private Larkup Cloud runtime…
        </div>
      );
    const isConnected = !state.error;
    return (
      <div className="rounded-lg border bg-muted/20 px-3 py-2.5">
        <div className="flex items-center gap-2 text-sm">
          <span
            className={`size-2 shrink-0 rounded-full ${
              isConnected ? 'bg-emerald-500' : 'bg-destructive'
            }`}
            aria-label={isConnected ? `${mode.label} connected` : `${mode.label} unavailable`}
          />
          <span className="font-medium">{mode.label}</span>
          <span className="text-muted-foreground">{isConnected ? 'Connected' : 'Unavailable'}</span>
        </div>
        {state.error && <p className="mt-2 text-xs text-destructive">{state.error}</p>}
        {state.display?.userId && (
          <div className="mt-2 flex gap-2">
            <Input
              aria-label="Larkup Cloud user ID"
              className="h-8 min-w-0 flex-1 font-mono text-xs border-border/50"
              readOnly
              value={state.display.userId}
            />
            <Button
              aria-label="Copy user ID"
              className={copiedUserId ? 'text-black' : ''}
              onClick={() => {
                void navigator.clipboard
                  .writeText(state.display!.userId)
                  .then(() => {
                    setCopiedUserId(true);
                    toast.success('User ID copied.');
                    window.setTimeout(() => setCopiedUserId(false), 1_500);
                  })
                  .catch(() => toast.error('Could not copy the User ID.'));
              }}
              size="icon-sm"
              title="Copy user ID"
              variant="outline"
            >
              {copiedUserId ? (
                <Check className="size-3.5 text-green-600" />
              ) : (
                <Copy className="size-3.5" />
              )}
            </Button>
          </div>
        )}
      </div>
    );
  }
  if (mode.id === 'local' || mode.id === 'local-docker' || mode.id === 'local-process')
    return (
      <LocalRuntimeControls
        tool={tool}
        hasUnsavedChanges={hasUnsavedChanges}
        runtimeConfig={runtimeConfig}
        serverId={serverId}
      />
    );
  return (
    <div className="rounded-lg border bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
      {mode.description}
    </div>
  );
}

type LocalHostReport = {
  docker?: { cliInstalled: boolean; daemonRunning: boolean; imagePulled: boolean; message: string };
  native?: { uvInstalled: boolean; depsInstalled: boolean; message: string };
  recommendedKind?: 'local-docker' | 'local-process' | null;
  installed?: boolean;
  running?: boolean;
  suitability?: { level: 'good' | 'tight' | 'unknown'; message: string };
  acceleration?: {
    device: 'cuda' | 'cpu';
    message: string;
    gpuName?: string;
    gpuMemoryGB?: number;
  };
  system?: { platform: string; cpus: number; totalMemGB: number; freeMemGB: number };
  modelRequirement?: {
    configured: boolean;
    provider?: string;
    model?: string;
    message: string;
  };
};

function LocalRuntimeControls({
  tool,
  hasUnsavedChanges,
  runtimeConfig,
  serverId,
}: {
  tool: InstalledTool;
  hasUnsavedChanges: boolean;
  runtimeConfig: Record<string, string | boolean>;
  serverId?: string;
}) {
  const query = serverId ? `?serverId=${encodeURIComponent(serverId)}` : '';
  const hostUrl = `/api/tools/${encodeURIComponent(tool.id)}/host${query}`;
  const { data: host, mutate } = useSWR<LocalHostReport>(hostUrl, usageFetcher, {
    revalidateOnFocus: false,
  });
  const [busy, setBusy] = useState<'install' | 'start' | 'stop' | null>(null);
  const [installAlertOpen, setInstallAlertOpen] = useState(false);

  async function run(action: 'install' | 'start' | 'stop') {
    setBusy(action);
    try {
      const response = await fetch(`/api/tools/${encodeURIComponent(tool.id)}/runtime${query}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, config: runtimeConfig }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Could not ${action} the local runtime.`);
      toast.success(
        action === 'install'
          ? 'Local runtime installed.'
          : action === 'start'
            ? 'Local runtime is running.'
            : 'Local runtime stopped.',
      );
      // Optimistic update first so the UI flips immediately
      await mutate(
        (current) => {
          if (!current) return current;
          return {
            ...current,
            installed: action === 'install' ? true : current.installed,
            running: action === 'start' ? true : action === 'stop' ? false : current.running,
          };
        },
        { revalidate: false },
      );
      // Then revalidate from the server after a short delay to confirm the real state
      if (action === 'stop' || action === 'start') {
        window.setTimeout(() => void mutate(), 1_500);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : `Could not ${action} the local runtime.`,
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="rounded-lg border bg-muted/20 px-3 py-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md border bg-background">
            <img src="/docker.png" alt="Local runtime" className="size-5 object-contain" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Local runtime</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              Run the application locally on your computer.
            </p>
            {host?.modelRequirement && (
              <p
                className={`mt-2 text-xs ${
                  host.modelRequirement.configured
                    ? 'text-muted-foreground'
                    : 'text-amber-700 dark:text-amber-300'
                }`}
              >
                {host.modelRequirement.message}
              </p>
            )}
          </div>
          <span
            className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
              host?.running
                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            {host?.running ? 'Running' : 'Stopped'}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {!host?.installed ? (
            <Button size="sm" disabled={busy !== null} onClick={() => setInstallAlertOpen(true)}>
              {busy === 'install' ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Download className="size-3.5" />
              )}
              Install local runtime
            </Button>
          ) : host.running ? (
            <Button
              size="sm"
              variant="destructive"
              disabled={busy !== null}
              onClick={() => void run('stop')}
            >
              {busy === 'stop' ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Square className="size-3.5" />
              )}
              Stop
            </Button>
          ) : (
            <Button size="sm" disabled={busy !== null} onClick={() => void run('start')}>
              {busy === 'start' ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Play className="size-3.5" />
              )}
              Start
            </Button>
          )}
          {host?.installed && !host.running && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() => setInstallAlertOpen(true)}
            >
              Reinstall
            </Button>
          )}
          {hasUnsavedChanges && (
            <span className="self-center text-xs text-muted-foreground">
              Local changes will be applied for this action.
            </span>
          )}
        </div>
      </div>
      <GenericAlert
        open={installAlertOpen}
        onOpenChange={setInstallAlertOpen}
        title="Install local GPU runtime?"
        description={
          <div className="space-y-2 text-sm">
            <p>
              Video Intelligence runs analysis on this computer. For fast, accurate video
              understanding, use a powerful CUDA-capable NVIDIA GPU (12 GB+ VRAM recommended); CPU
              fallback is supported but can be much slower on long videos.
            </p>
            {host?.system && (
              <p>
                {host.system.cpus} CPU cores · {host.system.freeMemGB.toFixed(1)} GB RAM currently
                free.
              </p>
            )}
            {host?.acceleration && <p>{host.acceleration.message}</p>}
            <p>
              {host?.suitability?.message ??
                'Larkup will check the computer again before it starts.'}
            </p>
            <p className="text-amber-700 dark:text-amber-300">
              Continue only if you are comfortable downloading local models and using this
              machine&apos;s GPU/CPU while indexing runs.
            </p>
            <p>
              {host?.modelRequirement?.message ??
                'Configure a vision-capable model before indexing video.'}
            </p>
          </div>
        }
        actionText="Install runtime"
        onAction={() => void run('install')}
      />
    </>
  );
}

export function MarketplaceToolsSettings({ embedded = false }: { embedded?: boolean }) {
  const { activeProject } = useProject();
  const serverId = activeProject?.id;
  const configUrl = serverId
    ? `/api/config?serverId=${encodeURIComponent(serverId)}`
    : '/api/config';
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
  } = useSWR<{ config: RagConfig }>(configUrl, fetcher);
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
  const providerFor = (tool: InstalledTool, field: ConfigField) => {
    const savedValue = form[tool.id]?.[field.key];
    if (typeof savedValue === 'string' && savedValue) return savedValue;
    const configuredProvider = field.defaultFromGlobalConfigKey
      ? configData?.config[field.defaultFromGlobalConfigKey]
      : undefined;
    if (
      typeof configuredProvider === 'string' &&
      field.options?.some((option) => option.value === configuredProvider)
    ) {
      return configuredProvider;
    }
    return field.defaultValue ?? 'vercel_ai_gateway';
  };
  const valueFor = (tool: InstalledTool, field: ConfigField): string | boolean => {
    const savedValue = form[tool.id]?.[field.key];
    if (field.defaultFromGlobalConfigKey) return providerFor(tool, field);
    if (field.providerField) {
      const providerField = tool.configSchema?.find(
        (candidate) => candidate.key === field.providerField,
      );
      const provider = providerField ? String(valueFor(tool, providerField)) : 'vercel_ai_gateway';
      const options = modelsForProvider(field.options, provider) ?? [];
      if (
        typeof savedValue === 'string' &&
        savedValue !== 'auto' &&
        options.some((option) => option.value === savedValue)
      ) {
        return savedValue;
      }
      return (
        field.defaultValueByProvider?.[provider] ?? field.defaultValue ?? options[0]?.value ?? ''
      );
    }
    if (savedValue !== undefined) return savedValue;

    return field.type === 'toggle' ? field.defaultValue === 'true' : (field.defaultValue ?? '');
  };
  function update(toolId: string, key: string, value: string | boolean) {
    setForm((current) => ({ ...current, [toolId]: { ...current[toolId], [key]: value } }));
    setVerifyStatus((current) => ({ ...current, [toolId]: undefined }));
  }
  function applySelectValue(tool: InstalledTool, field: ConfigField, value: string) {
    update(tool.id, field.key, value);
    for (const dependent of tool.configSchema ?? []) {
      if (dependent.providerField !== field.key) continue;
      update(
        tool.id,
        dependent.key,
        dependent.defaultValueByProvider?.[value] ?? dependent.defaultValue ?? '',
      );
    }
    if (field.key !== 'runtimeMode') return;
    const mode = tool.runtime?.modes.find((candidate) => candidate.id === value);
    if (!mode) return;
    if (
      mode.credentialConfigKey &&
      (mode.id === 'local' || mode.id === 'local-docker' || mode.id === 'local-process') &&
      !form[tool.id]?.[mode.credentialConfigKey]
    ) {
      update(
        tool.id,
        mode.credentialConfigKey,
        `lvi_local_${crypto.randomUUID().replace(/-/g, '')}`,
      );
    }
    if (
      mode.id === 'local' &&
      (!form[tool.id]?.audioProvider ||
        form[tool.id]?.audioProvider === 'larkup-cloud' ||
        form[tool.id]?.audioProvider === 'local')
    ) {
      update(tool.id, 'audioProvider', 'deepgram');
    }
  }
  function selectValue(tool: InstalledTool, field: ConfigField, value: string) {
    applySelectValue(tool, field, value);
  }
  async function save(toolId: string) {
    if (!configData?.config) return;
    setSaving(toolId);
    try {
      const response = await fetch(configUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...configData.config, toolConfigs: form }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Could not save tool settings.');
      await mutateConfig(result, { revalidate: false });
      const previous = configData.config.toolConfigs?.[toolId] ?? {};
      const next = form[toolId] ?? {};
      const localKeyChanged =
        (next.runtimeMode === 'local' ||
          next.runtimeMode === 'local-docker' ||
          next.runtimeMode === 'local-process') &&
        next.localRuntimeApiKey !== previous.localRuntimeApiKey;
      if (localKeyChanged) {
        toast.success('Local runtime settings saved.', {
          description: 'Restart the local runtime to apply the shared API key.',
          action: {
            label: 'Restart runtime',
            onClick: () =>
              void fetch(
                `/api/tools/${encodeURIComponent(toolId)}/runtime${
                  serverId ? `?serverId=${encodeURIComponent(serverId)}` : ''
                }`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ action: 'restart' }),
                },
              )
                .then(async (restartResponse) => {
                  const restartResult = await restartResponse.json().catch(() => ({}));
                  if (!restartResponse.ok)
                    throw new Error(restartResult.error || 'Could not restart local runtime.');
                  toast.success('Local runtime restarted.');
                })
                .catch((restartError) =>
                  toast.error(
                    restartError instanceof Error
                      ? restartError.message
                      : 'Could not restart local runtime.',
                  ),
                ),
          },
        });
      } else {
        toast.success('Tool configuration saved successfully.');
      }
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
                  : (tool.configSchema?.find((candidate) => candidate.key === configKey) ?? field),
              ),
            ),
          ],
        ),
      );
      const response = await fetch(verification.endpoint, {
        method: verification.method ?? 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          config: Object.fromEntries(
            (tool.configSchema ?? []).map((candidate) => [
              candidate.key,
              valueFor(tool, candidate),
            ]),
          ),
          verifyKey: field.key,
        }),
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
          const fields = (tool.configSchema ?? []).filter((field) => !field.serverManaged);
          const dirty =
            JSON.stringify(form[tool.id] ?? {}) !==
            JSON.stringify(configData.config.toolConfigs?.[tool.id] ?? {});
          const status = verifyStatus[tool.id];
          const groups = groupConfigFields(fields.filter((field) => isVisible(tool, field, form)));
          const runtimeMode = String(
            valueFor(
              tool,
              tool.configSchema?.find((field) => field.key === 'runtimeMode') ?? {
                key: 'runtimeMode',
                label: 'Runtime',
                type: 'select',
                defaultValue: tool.runtime?.defaultMode ?? 'managed-cloud',
              },
            ),
          );
          const selectedRuntime = tool.runtime?.modes.find((mode) => mode.id === runtimeMode);
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
                {selectedRuntime && (
                  <ToolRuntimeConnection
                    tool={tool}
                    mode={selectedRuntime}
                    hasUnsavedChanges={dirty}
                    runtimeConfig={form[tool.id] ?? {}}
                    serverId={serverId}
                  />
                )}
                <ToolUsageSummary
                  tool={tool}
                  runtimeMode={runtimeMode}
                  toolConfig={form[tool.id] ?? {}}
                  serverId={serverId}
                />
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
                  {groups.map(([group, groupFields], groupIndex) => {
                    const belongsToSelectedRuntime = groupFields.every(
                      (field) => field.visibleWhen?.field === 'runtimeMode',
                    );
                    return (
                      <section
                        key={group || `default-${groupIndex}`}
                        className={
                          groupIndex === 0 ||
                          (runtimeMode === 'managed-cloud' && belongsToSelectedRuntime)
                            ? ''
                            : 'border-t pt-5'
                        }
                      >
                        {group && <h2 className="mb-4 text-sm font-medium">{group}</h2>}
                        <div className="grid gap-x-5 gap-y-5 md:grid-cols-2">
                          {groupFields.map((field) => {
                            const value = valueFor(tool, field);
                            const providerField = field.providerField
                              ? tool.configSchema?.find(
                                  (candidate) => candidate.key === field.providerField,
                                )
                              : undefined;
                            const options = providerField
                              ? modelsForProvider(
                                  field.options,
                                  String(valueFor(tool, providerField)),
                                )
                              : field.options;
                            const selectedOption = options?.find(
                              (option) => option.value === value,
                            );
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
                                  <div className="flex gap-2">
                                    <Select
                                      value={String(value)}
                                      onValueChange={(next) =>
                                        next && selectValue(tool, field, next)
                                      }
                                    >
                                      <SelectTrigger id={secretId} className="min-w-0 flex-1">
                                        <div className="flex min-w-0 items-center gap-2">
                                          {(selectedOption?.image ?? selectedOption?.icon) && (
                                            <img
                                              src={selectedOption.image ?? selectedOption.icon}
                                              alt=""
                                              className="size-4 shrink-0 object-contain"
                                            />
                                          )}
                                          <span
                                            className={
                                              selectedOption
                                                ? 'truncate'
                                                : 'truncate text-muted-foreground'
                                            }
                                          >
                                            {selectedOption?.label ??
                                              `Choose ${field.label.toLowerCase()}`}
                                          </span>
                                        </div>
                                      </SelectTrigger>
                                      <SelectContent>
                                        {options?.map((option) => (
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
                                                <OptionDescription
                                                  description={option.description}
                                                />
                                              </span>
                                            </span>
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                    {field.verification && (
                                      <Button
                                        aria-label={`Verify ${field.label}`}
                                        className="h-10 px-4"
                                        disabled={
                                          (field.required && !value) || verifying === tool.id
                                        }
                                        onClick={() => void verify(tool, field)}
                                        size="default"
                                        variant="outline"
                                      >
                                        {verifying === tool.id ? (
                                          <Loader2 className="size-4 animate-spin" />
                                        ) : (
                                          'Verify'
                                        )}
                                      </Button>
                                    )}
                                  </div>
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
                                          field.key === 'videoVisionApiKey' && !value
                                            ? 'Using saved AI Models key'
                                            : field.type === 'password'
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
                                        aria-label={`Verify ${field.label}`}
                                        variant="outline"
                                        size="default"
                                        className={'h-10 px-5'}
                                        onClick={() => void verify(tool, field)}
                                        disabled={
                                          (field.required && !value) || verifying === tool.id
                                        }
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
                    );
                  })}
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
