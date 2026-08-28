'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  CheckCircle2,
  ChevronsUpDown,
  Cloud,
  Copy,
  Dices,
  Eye,
  EyeOff,
  ExternalLink,
  Loader2,
  Save,
  Send,
  Terminal,
  TestTube2,
  ChevronLeft,
  CableIcon,
  Search,
} from 'lucide-react';
import { toast } from 'sonner';
import type { ChannelSummary, ConnectionSummary } from '@larkup/connections';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useChannelOAuth } from '@/hooks/use-channel-oauth';
import { getDeploymentTarget } from '@/lib/deployments';
import { cn } from '@/lib/utils';
import {
  useConnectionFormStore,
  type AgentTarget,
  type ConnectionRecord,
} from '@/store/connections-store';
import { WidgetSection } from './widget-tab';

const fetcher = (url: string) => fetch(url).then((response) => response.json());

type Deployment = {
  id: string;
  name: string;
  endpoint: string;
  profile: string;
  status: string;
  provider: string;
};

type LocalTunnel = {
  status: 'running' | 'stopped' | 'unavailable';
  publicUrl?: string;
  detail: string;
};

const hiddenConnectionIds = new Set(['webhook']);

function ChannelIcon({
  name,
  icon,
  size = 'md',
}: {
  name: string;
  icon?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-lg bg-muted/30',
        size === 'md' ? 'h-10 w-10' : 'h-7 w-7',
      )}
    >
      {icon ? (
        <img
          src={icon}
          alt=""
          className={cn('object-contain', size === 'md' ? 'size-6' : 'size-4')}
        />
      ) : (
        <span className="text-sm font-semibold">{name.slice(0, 1)}</span>
      )}
    </div>
  );
}

/** A secret input with a per-field show/hide toggle — every credential field gets one. */
function SecretInput({
  id,
  value,
  visible,
  placeholder,
  onChange,
  onToggleVisible,
}: {
  id: string;
  value: string;
  visible: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
  onToggleVisible: () => void;
}) {
  return (
    <div className="relative">
      <Input
        id={id}
        type={visible ? 'text' : 'password'}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="pr-10"
      />
      <button
        type="button"
        aria-label={visible ? 'Hide value' : 'Show value'}
        onClick={onToggleVisible}
        className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

export function ConnectionsSection({ embedded = false }: { embedded?: boolean }) {
  const [activeView, setActiveView] = useState<'list' | 'widget'>('list');
  const { data } = useSWR<{
    connectionsCatalog: ConnectionSummary[];
    connections: ConnectionRecord[];
  }>('/api/connections', fetcher);
  const { data: runtime } = useSWR<{ runtime?: { endpoint?: string } }>(
    '/api/projects/runtime',
    fetcher,
  );
  const { data: deployments } = useSWR<{ deployments: Deployment[] }>(
    '/api/projects/deployments',
    fetcher,
  );
  const form = useConnectionFormStore();
  const [search, setSearch] = useState('');
  const [isRequestDialogOpen, setIsRequestDialogOpen] = useState(false);
  const [requestName, setRequestName] = useState('');
  const [requestEmail, setRequestEmail] = useState('');
  const [requestDetails, setRequestDetails] = useState('');
  const [requesting, setRequesting] = useState(false);
  const [connectionMethod, setConnectionMethod] = useState<'oauth' | 'credentials'>('oauth');
  const [ngrokAuthtoken, setNgrokAuthtoken] = useState('');
  const [ngrokOptionsOpen, setNgrokOptionsOpen] = useState(false);
  const [startingTunnel, setStartingTunnel] = useState(false);
  const [stoppingTunnel, setStoppingTunnel] = useState(false);

  const localEndpoint = runtime?.runtime?.endpoint || 'http://localhost:8080';
  const remoteAgents = useMemo(
    () => (deployments?.deployments ?? []).filter((item) => item.profile === 'assistant'),
    [deployments],
  );
  const targets = useMemo<AgentTarget[]>(
    () => [
      {
        key: 'local',
        mode: 'local',
        label: 'Local runtime',
        endpoint: localEndpoint,
        sublabel: localEndpoint,
      },
      ...remoteAgents.map((item) => ({
        key: item.id,
        mode: 'remote' as const,
        label: item.name,
        endpoint: item.endpoint,
        sublabel: item.status,
        icon: getDeploymentTarget(item.provider)?.icon,
        deploymentId: item.id,
      })),
    ],
    [localEndpoint, remoteAgents],
  );
  const selectedTarget = targets.find((target) => target.key === form.targetKey) ?? targets[0];
  const needsPublicIngress = Boolean(form.active?.connectionUi?.requiresPublicIngress);
  const savedProvider =
    form.current?.provider ??
    data?.connections.find((connection) => connection.id === form.active?.id)?.provider;
  const testUrl = savedProvider?.testUrl ?? form.active?.testUrl;
  const testUrlLabel = savedProvider?.testUrlLabel;
  const { data: tunnel, mutate: mutateTunnel } = useSWR<LocalTunnel>(
    needsPublicIngress ? '/api/connections/tunnel' : null,
    fetcher,
  );
  const connectionById = useMemo(
    () => new Map((data?.connections ?? []).map((connection) => [connection.id, connection])),
    [data?.connections],
  );
  const visibleConnections = useMemo(() => {
    const query = search.trim().toLowerCase();
    const priority = (connection: ConnectionSummary) => {
      if (connection.availability === 'available' && connectionById.get(connection.id)?.enabled) {
        return 0;
      }
      return connection.availability === 'available' ? 1 : 2;
    };

    return (data?.connectionsCatalog ?? [])
      .filter(
        (connection) =>
          !hiddenConnectionIds.has(connection.id) &&
          (!query || `${connection.name} ${connection.description}`.toLowerCase().includes(query)),
      )
      .sort((left, right) => priority(left) - priority(right));
  }, [connectionById, data?.connectionsCatalog, search]);
  function openConnection(channel: ChannelSummary) {
    const current = connectionById.get(channel.id);
    setConnectionMethod(
      current?.managed || (!current && channel.oauthConnect) ? 'oauth' : 'credentials',
    );
    form.open(channel, current, targets, localEndpoint);
  }

  function openRequestDialog(connection?: Pick<ConnectionSummary, 'name'>) {
    setRequestName(connection?.name ?? '');
    setIsRequestDialogOpen(true);
  }

  const channelOAuth = useChannelOAuth({
    onConnected: ({ channelId, fields }) => {
      if (form.active?.id !== channelId) return;
      void form.applyManagedOAuth(fields);
      setConnectionMethod('oauth');
    },
    onError: (error) => toast.error(error, { position: 'bottom-left' }),
  });

  async function startTunnel() {
    setStartingTunnel(true);
    try {
      const response = await fetch('/api/connections/tunnel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', authtoken: ngrokAuthtoken || undefined }),
      });
      const result = (await response.json()) as LocalTunnel & { error?: string };
      if (!response.ok)
        throw new Error(result.error ?? result.detail ?? 'Could not start the tunnel.');
      setNgrokAuthtoken('');
      setNgrokOptionsOpen(false);
      await mutateTunnel(result, false);
      if (form.current?.managed && form.active?.managedConnection?.relay) {
        // A free ngrok URL can change after a restart. Refresh the relay route
        // immediately so the Slack app's one fixed callback keeps working.
        await form.save();
      }
      toast.success('Your public HTTPS tunnel is ready.', { position: 'bottom-left' });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not start the tunnel.', {
        position: 'bottom-left',
      });
    } finally {
      setStartingTunnel(false);
    }
  }

  async function stopTunnel() {
    setStoppingTunnel(true);
    try {
      const response = await fetch('/api/connections/tunnel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      });
      const result = (await response.json()) as LocalTunnel & { error?: string };
      if (!response.ok)
        throw new Error(result.error ?? result.detail ?? 'Could not stop the tunnel.');
      await mutateTunnel(result, false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not stop the tunnel.', {
        position: 'bottom-left',
      });
    } finally {
      setStoppingTunnel(false);
    }
  }

  async function copyWebhookUrl() {
    if (!tunnel?.publicUrl || !form.active) return;
    await navigator.clipboard.writeText(
      `${tunnel.publicUrl.replace(/\/$/, '')}/api/connections/${form.active.id}`,
    );
    toast.success('Webhook URL copied.', { position: 'bottom-left' });
  }

  async function requestProvider() {
    if (!requestName.trim() || !requestEmail.trim()) return;
    setRequesting(true);
    try {
      const response = await fetch(
        process.env.NEXT_PUBLIC_CONNECT_API_URL || 'https://www.larkup.de/api/connect',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: requestName.trim(),
            email: requestEmail,
            message: `Channel request: ${requestName.trim()}. ${requestDetails}`,
          }),
        },
      );
      if (!response.ok) throw new Error('Could not send the request.');
      toast.success(`Your ${requestName.trim()} channel request was sent.`, {
        position: 'bottom-left',
      });
      setIsRequestDialogOpen(false);
      setRequestName('');
      setRequestEmail('');
      setRequestDetails('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not send the request.', {
        position: 'bottom-left',
      });
    } finally {
      setRequesting(false);
    }
  }

  function credentialFields() {
    const activeConnection = form.active;
    if (!activeConnection) return null;
    return (
      <div className="space-y-4 rounded-xl border p-3">
        <p className="text-xs font-medium text-primary">2. Connect {activeConnection.name}</p>
        <p className="text-xs text-muted-foreground">
          {activeConnection.connectionUi?.credentialsDescription ??
            `Enter the credentials for your own ${activeConnection.name} app.`}
        </p>
        {form.managed && (
          <p className="rounded-lg bg-muted/60 px-2.5 py-2 text-[11px] text-muted-foreground">
            Managed OAuth is active. Saved credentials stay hidden, and any shared provider secrets
            are handled by Larkup. Enter values below only to switch to your own app.
          </p>
        )}
        {activeConnection.configFields
          .filter((field) => !field.hidden)
          .map((field) => {
            const sharedManagedSecret =
              form.managed && activeConnection.managedConnection?.sharedSecretField === field.key;
            return (
              <div key={field.key} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor={field.key}>
                    {field.label}
                    {field.required ? ' *' : ''}
                  </Label>
                  {field.helpUrl && (
                    <a
                      href={field.helpUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                    >
                      Open {activeConnection.name} setup
                      <ExternalLink className="size-3" />
                    </a>
                  )}
                  {field.canGenerate && (
                    <button
                      type="button"
                      onClick={() => form.generateFieldValue(field.key)}
                      className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                    >
                      Generate
                      <Dices className="size-3" />
                    </button>
                  )}
                </div>
                {field.type === 'secret' ? (
                  <SecretInput
                    id={field.key}
                    value={form.settings[field.key] ?? ''}
                    visible={Boolean(form.visibleFields[field.key])}
                    placeholder={
                      form.current?.settings[field.key]
                        ? 'Saved — leave blank to keep'
                        : field.placeholder
                    }
                    onChange={(value) => {
                      form.setFieldValue(field.key, value);
                      if (form.managed && value.trim()) form.setManaged(false);
                    }}
                    onToggleVisible={() => form.toggleFieldVisibility(field.key)}
                  />
                ) : (
                  <Input
                    id={field.key}
                    type={field.type === 'boolean' ? 'text' : field.type}
                    value={form.settings[field.key] ?? ''}
                    placeholder={field.placeholder}
                    onChange={(event) => {
                      const value = event.target.value;
                      form.setFieldValue(field.key, value);
                      if (form.managed && value.trim()) form.setManaged(false);
                    }}
                  />
                )}
                {sharedManagedSecret ? (
                  <p className="flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="size-3" />
                    Managed by Larkup and never stored in this Project.
                  </p>
                ) : field.type === 'secret' && form.current?.settings[field.key] ? (
                  <p className="flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="size-3" />
                    Saved — hidden here for security. Leave blank to keep it.
                  </p>
                ) : null}
                {field.help && <p className="text-[11px] text-muted-foreground">{field.help}</p>}
              </div>
            );
          })}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (activeView === 'widget') {
    return (
      <div className="space-y-4 animate-in fade-in-0 duration-200">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setActiveView('list')}
          className="-ml-3 text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="mr-1 size-4" />
          Back to connections
        </Button>
        <WidgetSection embedded />
      </div>
    );
  }

  return (
    <section className="space-y-5">
      <div>
        <div>
          {!embedded && <h2 className="text-lg font-semibold">Connections</h2>}
          <p className="text-sm text-muted-foreground">
            Connect a provider once, choose the Agent that replies, then send a real test message.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search connections"
            placeholder="Search connections..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-9 pl-9  bg-white"
          />
        </div>
        <Button
          variant="default"
          size="sm"
          className="h-8 gap-2"
          onClick={() => openRequestDialog()}
        >
          <CableIcon className="size-3.5" />
          Ask for a connection
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div
          data-testid="connection-card-widget"
          className={cn(
            'group flex items-center justify-between gap-3.5 rounded-xl border px-4 py-3.5 text-left transition-all',
            'border-border bg-white/80 hover:border-primary/20 hover:bg-white dark:bg-card/60 dark:hover:bg-card',
          )}
        >
          <div className="flex min-w-0 items-center gap-3.5">
            <ChannelIcon name="Chat Widget" icon="/logo.png" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">Chat Widget</span>
                <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-600">
                  <CheckCircle2 className="size-3" />
                  Active
                </span>
              </div>
              <p className="mt-0.5 truncate text-xs text-muted-foreground max-w-50">
                Embed a custom AI chat on your website.
              </p>
            </div>
          </div>
          <div className="shrink-0">
            <Button variant="default" size="sm" onClick={() => setActiveView('widget')}>
              Customize
            </Button>
          </div>
        </div>

        {visibleConnections.map((provider) => {
          if (provider.availability === 'coming_soon') {
            return (
              <div
                key={provider.id}
                className="flex items-center justify-between gap-3.5 rounded-xl border border-dashed border-border/60 bg-muted/15 px-4 py-3.5 text-left"
              >
                <div className="flex min-w-0 items-center gap-3.5">
                  <ChannelIcon name={provider.name} icon={provider.icon} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{provider.name}</span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        Coming soon
                      </span>
                    </div>
                    <p className="mt-0.5 max-w-50 truncate text-xs text-muted-foreground">
                      {provider.description}
                    </p>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => openRequestDialog(provider)}>
                  Request
                </Button>
              </div>
            );
          }

          const connection = connectionById.get(provider.id);
          const isConnected = Boolean(connection?.enabled);
          return (
            <div
              key={provider.id}
              data-testid="connection-card"
              className={cn(
                'group flex items-center justify-between gap-3.5 rounded-xl border px-4 py-3.5 text-left transition-all',
                'border-border bg-white/80 hover:border-primary/20 hover:bg-white dark:bg-card/60 dark:hover:bg-card',
              )}
            >
              <div className="flex min-w-0 items-center gap-3.5">
                <ChannelIcon name={provider.name} icon={provider.icon} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{provider.name}</span>
                    {isConnected && (
                      <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-600">
                        <CheckCircle2 className="size-3" />
                        Connected
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground max-w-50">
                    {provider.description}
                  </p>
                  {connection && (
                    <p className="mt-0.5 truncate text-[10px] text-muted-foreground/70">
                      {connection.target.mode === 'local' ? 'Local' : 'Remote'} ·{' '}
                      {connection.target.endpoint}
                    </p>
                  )}
                </div>
              </div>
              <div className="shrink-0">
                <Button
                  variant={isConnected ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => openConnection(provider)}
                >
                  {isConnected ? 'Configure' : 'Connect'}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <Sheet open={Boolean(form.active)} onOpenChange={(open) => !open && form.close()}>
        <SheetContent side="right" className="flex  flex-col p-0 max-w-[90%]! w-187.5!">
          <SheetHeader className="border-b p-6">
            <SheetTitle className="flex items-center gap-2">
              {form.active && (
                <ChannelIcon name={form.active.name} icon={form.active.icon} size="sm" />
              )}
              {form.current ? 'Configure' : 'Connect'} {form.active?.name}
            </SheetTitle>
            <SheetDescription>
              Follow the three steps below. Provider secrets stay private to this Project.
              <span className="mt-1 block font-medium text-foreground">
                Only Agent Servers can receive channels.
              </span>
            </SheetDescription>
          </SheetHeader>
          {form.active && (
            <div className="flex-1 space-y-4 overflow-y-auto p-6">
              <div className="rounded-xl border bg-muted/20 p-3">
                <p className="text-xs font-medium text-primary">1. Choose the Agent</p>
                <Label className="mt-2 block">Agent target</Label>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="outline"
                        className="mt-2 w-full justify-between font-normal"
                      />
                    }
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {selectedTarget?.mode === 'local' ? (
                        <Terminal className="size-4 shrink-0 text-muted-foreground" />
                      ) : selectedTarget?.icon ? (
                        <img
                          src={selectedTarget.icon}
                          alt=""
                          className="size-4 shrink-0 object-contain"
                        />
                      ) : (
                        <Cloud className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate">
                        {selectedTarget?.label ?? 'Select an Agent target'}
                      </span>
                    </span>
                    <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-(--anchor-width)">
                    {targets.map((target) => (
                      <DropdownMenuItem key={target.key} onClick={() => form.selectTarget(target)}>
                        {target.mode === 'local' ? (
                          <Terminal className="size-4 text-muted-foreground" />
                        ) : target.icon ? (
                          <img src={target.icon} alt="" className="size-4 object-contain" />
                        ) : (
                          <Cloud className="size-4 text-muted-foreground" />
                        )}
                        <span className="min-w-0 flex-1 truncate">{target.label}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {target.mode === 'local' ? 'Local' : target.sublabel}
                        </span>
                      </DropdownMenuItem>
                    ))}
                    {!remoteAgents.length && (
                      <p className="px-1.5 py-2 text-[11px] text-muted-foreground">
                        Deploy an Agent Server to see remote targets here.
                      </p>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
                <div className="mt-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="agent-endpoint">Agent endpoint</Label>
                    {needsPublicIngress && tunnel?.status !== 'running' && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => setNgrokOptionsOpen((open) => !open)}
                      >
                        Use ngrok
                      </Button>
                    )}
                  </div>
                  <Input
                    id="agent-endpoint"
                    value={form.endpoint}
                    onChange={(event) => form.setEndpoint(event.target.value)}
                  />
                  {needsPublicIngress && (
                    <Collapsible open={ngrokOptionsOpen} onOpenChange={setNgrokOptionsOpen}>
                      <CollapsibleContent className="mt-2 space-y-2">
                        <div className="flex items-center gap-2">
                          <Input
                            aria-label="ngrok authtoken"
                            type="password"
                            value={ngrokAuthtoken}
                            onChange={(event) => setNgrokAuthtoken(event.target.value)}
                            placeholder="ngrok authtoken (needed once)"
                            className="h-8"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 shrink-0"
                            onClick={() => void startTunnel()}
                            disabled={startingTunnel}
                          >
                            {startingTunnel ? <Loader2 className="size-3.5 animate-spin" /> : null}
                            Generate HTTPS
                          </Button>
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          {tunnel?.detail ??
                            'Creates an HTTPS address for this Larkup app on this computer.'}{' '}
                          <a
                            href="https://dashboard.ngrok.com/get-started/setup/"
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-primary hover:underline"
                          >
                            Set up ngrok <ExternalLink className="inline size-3" />
                          </a>
                        </p>
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                  {needsPublicIngress && tunnel?.status === 'running' && tunnel.publicUrl && (
                    <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-2.5 py-2">
                      <span className="shrink-0 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                        HTTPS
                      </span>
                      <code className="min-w-0 flex-1 truncate text-[11px]">
                        {tunnel.publicUrl}
                      </code>
                      {connectionMethod === 'credentials' &&
                        !form.active.supportsWebhookRegistration && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Copy public webhook URL"
                            onClick={copyWebhookUrl}
                          >
                            <Copy className="size-3.5" />
                          </Button>
                        )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-1.5 text-[11px]"
                        onClick={() => void stopTunnel()}
                        disabled={stoppingTunnel}
                      >
                        {stoppingTunnel ? <Loader2 className="size-3 animate-spin" /> : null}
                        Stop
                      </Button>
                    </div>
                  )}
                  <p className="text-[11px] text-muted-foreground">
                    {form.active.connectionUi?.endpointHint ??
                      'This can stay local while testing. Your provider needs the public webhook URL shown after you save, not direct access to this Agent endpoint.'}
                  </p>
                </div>
                <div className="mt-3 space-y-1.5">
                  <Label htmlFor="agent-key">Agent retrieval API key</Label>
                  <SecretInput
                    id="agent-key"
                    value={form.apiKey}
                    visible={form.showApiKey}
                    placeholder={
                      form.current?.target.apiKey
                        ? 'Saved key'
                        : 'Required when the Agent uses API keys'
                    }
                    onChange={form.setApiKey}
                    onToggleVisible={form.toggleShowApiKey}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Auto-filled from the key saved for this target — override if needed.
                  </p>
                </div>
              </div>

              {form.active.oauthConnect ? (
                <Tabs
                  value={connectionMethod}
                  onValueChange={(value) => setConnectionMethod(value as 'oauth' | 'credentials')}
                >
                  <TabsList className="w-full max-w-xs bg-white h-9!">
                    <TabsTrigger className={'rounded-xs!'} value="oauth">
                      OAuth
                    </TabsTrigger>
                    <TabsTrigger className={'rounded-xs!'} value="credentials">
                      Credentials
                    </TabsTrigger>
                  </TabsList>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Choose OAuth for the managed setup, or Credentials when using your own app.
                  </p>
                  <TabsContent value="oauth" className="pt-3">
                    <div className="space-y-3 rounded-xl border bg-muted/20 p-3">
                      <div>
                        <p className="text-xs font-medium text-primary">
                          2. Connect {form.active.name}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {form.active.oauthConnect.description ??
                            `Authorize Larkup to connect your ${form.active.name} workspace.`}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant={form.managed ? 'outline' : 'default'}
                        className="w-full gap-2"
                        onClick={() => channelOAuth.connect(form.active!.oauthConnect!.startUrl)}
                      >
                        <img src={form.active.icon} alt="" className="size-4 object-contain" />
                        {form.managed
                          ? `Reconnect ${form.active.name}`
                          : form.active.oauthConnect.label}
                      </Button>
                      {form.managed ? (
                        <p className="flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 className="size-3" />
                          OAuth credentials are saved securely for this Project.
                        </p>
                      ) : (
                        <p className="text-[11px] text-muted-foreground">
                          {form.active.oauthConnect.completionHint ??
                            'Larkup securely saves the credentials returned by the provider.'}
                        </p>
                      )}
                    </div>
                  </TabsContent>
                  <TabsContent value="credentials" className="pt-3">
                    {credentialFields()}
                  </TabsContent>
                </Tabs>
              ) : (
                credentialFields()
              )}

              {(form.webhookRegistration ||
                (!form.managed && form.active.setupInstructions?.length)) && (
                <div className="space-y-2 rounded-xl border bg-muted/20 p-3">
                  {!form.managed && form.active.setupInstructions?.length ? (
                    <p className="text-xs font-medium text-primary">Provider setup</p>
                  ) : null}
                  {form.webhookRegistration && (
                    <p className="flex items-start gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
                      {form.webhookRegistration.detail}
                    </p>
                  )}
                  {!form.managed && form.active.setupInstructions?.length ? (
                    <ol className="space-y-1 pl-4 text-[11px] text-muted-foreground">
                      {form.active.setupInstructions.map((instruction) => (
                        <li key={instruction} className="list-decimal pl-1">
                          {instruction}
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </div>
              )}

              <div className="space-y-3 rounded-xl border p-3">
                <div>
                  <p className="text-xs font-medium text-primary">3. Save and test</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {form.active.testHint ??
                      `Save this connection, then send a real ${form.active.name} message.`}
                  </p>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/30 p-3">
                  <div>
                    <p className="text-sm font-medium">Channel enabled</p>
                    <p className="text-xs text-muted-foreground">
                      Disable to pause inbound messages without losing setup.
                    </p>
                  </div>
                  <Switch checked={form.enabled} onCheckedChange={form.setEnabled} />
                </div>
              </div>

              {form.current && form.active.connectionUi?.contact && (
                <div className="space-y-2 rounded-xl border p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">Use your assistant</p>
                    {form.active.connectionUi.contact.mention && (
                      <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium text-foreground">
                        {form.active.connectionUi.contact.mention}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {form.active.connectionUi.contact.directMessage}
                  </p>
                  {form.active.connectionUi.contact.channelMessage && (
                    <p className="text-sm text-muted-foreground">
                      {form.active.connectionUi.contact.channelMessage}
                    </p>
                  )}
                </div>
              )}

              {form.current && testUrl && (
                <Button
                  variant="outline"
                  className="w-full"
                  render={<a href={testUrl} target="_blank" rel="noreferrer" />}
                  nativeButton={false}
                >
                  {testUrlLabel ?? `Open ${form.active.name} bot`}
                  <ExternalLink className="size-3.5" />
                </Button>
              )}
            </div>
          )}
          <SheetFooter className="flex-row items-center gap-2 border-t p-4">
            {form.current && (
              <Button
                variant="destructive"
                className="mr-auto"
                onClick={() => {
                  if (
                    window.confirm(
                      `Disconnect ${form.active?.name}? This removes its saved credentials.`,
                    )
                  ) {
                    void form.remove();
                  }
                }}
                disabled={form.removing}
              >
                {form.removing ? <Loader2 className="size-4 animate-spin" /> : null}
                Disconnect
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => void form.test()}
              disabled={!form.endpoint || form.testing}
            >
              {form.testing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <TestTube2 className="size-4" />
              )}
              Check setup
            </Button>
            <Button
              onClick={() => void form.save()}
              disabled={form.saving || (needsPublicIngress && tunnel?.status !== 'running')}
            >
              {form.saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              {form.current ? 'Save changes' : 'Save & continue'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Dialog
        open={isRequestDialogOpen}
        onOpenChange={(open) => !open && setIsRequestDialogOpen(false)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Request a connection</DialogTitle>
            <DialogDescription>
              Tell us where you plan to use this channel. We’ll prioritize requests from active
              Agent projects.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="channel-request-name">Connection or channel</Label>
              <Input
                id="channel-request-name"
                value={requestName}
                onChange={(event) => setRequestName(event.target.value)}
                placeholder="e.g. WhatsApp, Microsoft Teams"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="channel-request-email">Work email</Label>
              <Input
                id="channel-request-email"
                type="email"
                value={requestEmail}
                onChange={(event) => setRequestEmail(event.target.value)}
                placeholder="you@company.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="channel-request-details">
                How will you use it? <span className="text-muted-foreground">Optional</span>
              </Label>
              <Textarea
                id="channel-request-details"
                value={requestDetails}
                onChange={(event) => setRequestDetails(event.target.value)}
                placeholder="Support, sales, appointment booking…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRequestDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void requestProvider()}
              disabled={requesting || !requestName.trim() || !requestEmail.trim()}
            >
              {requesting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              Apply for access
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
