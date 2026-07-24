'use client';

import { useState, useEffect, useRef } from 'react';
import useSWR, { mutate as globalMutate } from 'swr';
import {
  Loader2,
  Play,
  Square,
  ExternalLink,
  Terminal,
  Copy,
  CheckCircle2,
  RefreshCw,
  Trash2,
  Rocket,
  KeyRound,
  Eye,
  EyeOff,
  Pencil,
  X,
  Globe,
  ServerIcon,
  MoreHorizontal,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { useWorkspace } from '@/components/workspace/workspace-provider';
import { SdkConnectDialog } from '@/components/simple/sdk-connect-dialog';
import { DeployButton } from '@/components/server/deploy-button';
import { cn } from '@/lib/utils';
import {
  deploymentEndpoint,
  getApiKeyVersion,
  getDeployments,
  incrementApiKeyVersion,
  removeDeployment,
  updateDeployment,
  updateDeploymentUrl,
  type DeploymentRecord,
} from '@/lib/deployments';
import { getVercelDeploymentStatus } from '@/app/actions/vercel';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function deploymentUrl(url: string) {
  return url.replace(/\/$/, '');
}

function apiReferenceUrl(url: string) {
  return `${deploymentUrl(url)}/reference`;
}

function ApiReferenceLink({
  url,
  project,
  compact = false,
}: {
  url: string;
  project: string;
  compact?: boolean;
}) {
  return (
    <a
      href={apiReferenceUrl(url)}
      target="_blank"
      rel="noreferrer"
      aria-label={`Open API reference for ${project}`}
      className={cn(
        buttonVariants({ variant: compact ? 'ghost' : 'outline', size: compact ? 'icon' : 'sm' }),
        compact ? 'size-8 sm:hidden' : 'hidden h-8 gap-1.5 px-2 text-xs sm:inline-flex',
      )}
    >
      <ExternalLink className={compact ? 'size-4' : 'size-3'} />
      {!compact && 'API reference'}
    </a>
  );
}

interface LocalServerState {
  running: boolean;
  pid?: number;
  port: number;
  endpoint: string;
  startedAt?: string;
  lastError?: string;
}

export function ServerSection() {
  const { activeServer, refresh } = useWorkspace();
  const serverId = activeServer?.id || 'default';

  const [busy, setBusy] = useState<'start' | 'stop' | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedDeploymentId, setCopiedDeploymentId] = useState<string | null>(null);
  const [copiedEndpoint, setCopiedEndpoint] = useState(false);
  const [apiKeyVersion, setApiKeyVersion] = useState(0);
  const [showApiKey, setShowApiKey] = useState(false);
  const [deployments, setDeployments] = useState<DeploymentRecord[]>([]);
  const [editingDeploymentId, setEditingDeploymentId] = useState<string | null>(null);
  const [editedDeploymentUrl, setEditedDeploymentUrl] = useState('');
  const [pendingApiKey, setPendingApiKey] = useState<string | null>(null);
  const [apiKeyChangeOpen, setApiKeyChangeOpen] = useState(false);
  const [deployOpenSignal, setDeployOpenSignal] = useState(0);
  // Ready records from before production aliases were resolved get one
  // reconciliation request; polling thereafter is reserved for active deploys.
  const reconciledVercelDeployments = useRef(new Set<string>());

  useEffect(() => {
    const savedApiKey = localStorage.getItem('rag_server_api_key');
    if (savedApiKey) setApiKey(savedApiKey);
    setApiKeyVersion(getApiKeyVersion(serverId));
    setDeployments(getDeployments(serverId));
    reconciledVercelDeployments.current.clear();
  }, [serverId]);

  useEffect(() => {
    const token = localStorage.getItem('vercel_token');
    // Also reconcile ready deployments once: older records may have persisted
    // the generated deployment hostname instead of the production domain.
    const vercelDeployments = deployments.filter((deployment) => deployment.provider === 'vercel');
    if (!token || vercelDeployments.length === 0) return;

    const deploymentsToRefresh = vercelDeployments.filter(
      (deployment) =>
        deployment.status === 'queued' ||
        deployment.status === 'building' ||
        (deployment.status === 'ready' && !reconciledVercelDeployments.current.has(deployment.id)),
    );
    if (deploymentsToRefresh.length === 0) return;

    let cancelled = false;
    const refreshVercelStatuses = async () => {
      const updates = await Promise.all(
        deploymentsToRefresh.map(async (deployment) => ({
          deployment,
          result: await getVercelDeploymentStatus(token, deployment.project),
        })),
      );
      if (cancelled) return;
      for (const { deployment, result } of updates) {
        if (result.status === 'ready') reconciledVercelDeployments.current.add(deployment.id);
        const url = result.hasProductionAlias ? result.url : undefined;
        if (
          result.status === 'unknown' ||
          (deployment.status === result.status && (!url || deployment.url === url))
        ) {
          continue;
        }
        setDeployments(updateDeployment(serverId, deployment.id, { status: result.status, url }));
      }
    };

    void refreshVercelStatuses();
    const hasPendingDeployment = deploymentsToRefresh.some(
      (deployment) => deployment.status === 'queued' || deployment.status === 'building',
    );
    const interval = hasPendingDeployment
      ? window.setInterval(() => void refreshVercelStatuses(), 8_000)
      : undefined;
    return () => {
      cancelled = true;
      if (interval) window.clearInterval(interval);
    };
  }, [deployments, serverId]);

  useEffect(() => {
    const refreshDeployments = (event: Event) => {
      const changedServerId = (event as CustomEvent<string>).detail;
      if (changedServerId === serverId) {
        setDeployments(getDeployments(serverId));
        setApiKeyVersion(getApiKeyVersion(serverId));
      }
    };
    window.addEventListener('larkup-deployments-change', refreshDeployments);
    return () => window.removeEventListener('larkup-deployments-change', refreshDeployments);
  }, [serverId]);

  const { data, mutate } = useSWR<{ state: LocalServerState }>('/api/server/local', fetcher, {
    refreshInterval: (d) => (d?.state.running ? 5000 : 0),
  });
  const state = data?.state;

  async function control(action: 'start' | 'stop') {
    setBusy(action);
    const isStarting = action === 'start';

    // Optimistically update local state
    mutate({ state: { ...(state as LocalServerState), running: isStarting } }, false);

    globalMutate(
      '/api/servers',
      (currentData: any) => {
        if (!currentData) return currentData;
        return {
          ...currentData,
          servers: currentData.servers.map((s: any) =>
            s.id === serverId ? { ...s, running: isStarting } : s,
          ),
        };
      },
      false,
    );

    try {
      const currentApiKey = localStorage.getItem('rag_server_api_key') || '';
      const res = await fetch('/api/server/local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, serverApiKey: currentApiKey }),
      });
      const body = await res.json();
      if (action === 'start') {
        if (body.state?.running) {
          toast.success('Server is running.');
        } else {
          toast.error(body.state?.lastError ?? 'Server did not start.');
          globalMutate('/api/servers'); // Revert
        }
      } else {
        toast.success('Server stopped.');
      }
      mutate();
      refresh();
    } catch {
      toast.error('Could not reach the server controller.');
      globalMutate('/api/servers'); // Revert
      mutate();
    } finally {
      setBusy(null);
    }
  }

  function handleApiKeyChange(v: string) {
    const previousKey = localStorage.getItem('rag_server_api_key') || '';
    setApiKey(v);
    localStorage.setItem('rag_server_api_key', v);
    if (v !== previousKey) setApiKeyVersion(incrementApiKeyVersion(serverId));
  }

  function requestApiKeyChange(v: string) {
    if (deployments.length > 0 && v !== (localStorage.getItem('rag_server_api_key') || '')) {
      setPendingApiKey(v);
      setApiKeyChangeOpen(true);
      return false;
    }
    handleApiKeyChange(v);
    return true;
  }

  function generateApiKey() {
    const key =
      'sk-' +
      Array.from(crypto.getRandomValues(new Uint8Array(24)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    if (requestApiKeyChange(key)) toast.success('API key generated');
  }

  function confirmApiKeyChange(deployToVercel: boolean) {
    if (pendingApiKey !== null) handleApiKeyChange(pendingApiKey);
    setPendingApiKey(null);
    setApiKeyChangeOpen(false);
    if (deployToVercel) {
      setDeployOpenSignal((signal) => signal + 1);
      toast.info('New API key saved. Configure the Vercel redeploy to sync it remotely.');
      return;
    }
    toast.info('API key updated locally. Redeploy cloud servers when you are ready to sync it.');
  }

  async function copyApiKey() {
    await navigator.clipboard.writeText(apiKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 1500);
  }

  async function copyCloudApiKey(deploymentId: string) {
    if (!apiKey) {
      toast.error('Generate or enter an API key before copying it.');
      return;
    }
    await navigator.clipboard.writeText(apiKey);
    setCopiedDeploymentId(deploymentId);
    setTimeout(() => setCopiedDeploymentId(null), 1500);
    toast.success('Cloud API key copied');
  }

  async function copyEndpoint() {
    if (!state?.endpoint) return;
    await navigator.clipboard.writeText(state.endpoint);
    setCopiedEndpoint(true);
    setTimeout(() => setCopiedEndpoint(false), 1500);
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-6  ">
      <header className="mb-12">
        <h2 className="text-lg font-semibold tracking-tight">Server</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Test locally, then deploy one retrieval and chat server anywhere.
        </p>
      </header>

      <section className="mb-14">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-medium">Local server</h3>
          </div>
          <span className="flex items-center gap-2 text-xs">
            {state?.running ? (
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-600 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-green-600" />
              </span>
            ) : (
              <span className="size-1.5 rounded-full bg-muted-foreground/40" />
            )}
            <span
              className={
                state?.running
                  ? 'font-medium text-emerald-600 dark:text-emerald-400'
                  : 'text-muted-foreground'
              }
            >
              {state?.running ? `running on :${state.port}` : 'stopped'}
            </span>
          </span>
        </div>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          Start the server locally to test your AI endpoints. Your configuration and API keys are
          applied automatically.
        </p>

        {state?.lastError && !state.running && (
          <Alert variant="destructive">
            <AlertTitle>Launch failed</AlertTitle>
            <AlertDescription className="wrap-break-word">{state.lastError}</AlertDescription>
          </Alert>
        )}

        {state?.running ? (
          <div className="mt-5 overflow-hidden rounded-lg border border-border">
            <button
              type="button"
              onClick={copyEndpoint}
              className="flex w-full items-center justify-between gap-3 border-b border-border bg-muted/30 px-4 py-3 text-left"
            >
              <span className="flex min-w-0 items-center gap-2.5 font-mono text-sm">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground">
                  <Copy className="size-3.5" />
                </span>
                <span className="truncate">{state.endpoint}</span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {copiedEndpoint ? 'Copied' : 'Click to copy'}
              </span>
            </button>
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <SdkConnectDialog serverUrl={state.endpoint} />
                <Dialog>
                  <DialogTrigger
                    render={
                      <Button variant="outline" size="sm" className="h-8 text-xs px-2 gap-1.5" />
                    }
                  >
                    <Terminal className="size-3" />
                    Try it (cURL)
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl!">
                    <DialogHeader>
                      <DialogTitle>cURL Example</DialogTitle>
                      <DialogDescription>
                        You can use this command to test your RAG server endpoint.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="relative rounded-md bg-muted p-4 mt-2 border border-border/50">
                      <pre className="font-mono text-xs overflow-x-auto text-foreground pb-4 pr-6">
                        <code>{`curl -X POST ${state.endpoint}/query \\
  -H "Content-Type: application/json" \\${
    apiKey ? `\n  -H "Authorization: Bearer ${apiKey}" \\` : ''
  }
  -d '{"query":"hello"}'`}</code>
                      </pre>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute top-2 right-2 h-6 w-6 text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          navigator.clipboard.writeText(
                            `curl -X POST ${
                              state.endpoint
                            }/query -H "Content-Type: application/json"${
                              apiKey ? ` -H "Authorization: Bearer ${apiKey}"` : ''
                            } -d '{"query":"hello"}'`,
                          );
                          toast.success('Command copied');
                        }}
                      >
                        <Copy className="size-3" />
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
                <a
                  href={apiReferenceUrl(state.endpoint)}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(
                    buttonVariants({ variant: 'outline', size: 'sm' }),
                    'h-8 gap-1.5 text-xs',
                  )}
                >
                  <ExternalLink className="size-3" />
                  API reference
                </a>
              </div>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => control('stop')}
                disabled={busy !== null}
              >
                {busy === 'stop' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Square className="size-4" />
                )}
                Stop server
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-5 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => control('start')} disabled={busy !== null}>
              {busy === 'start' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Play className="size-4" />
              )}
              {busy === 'start' ? 'Starting…' : 'Launch server'}
            </Button>
            <SdkConnectDialog serverUrl={state?.endpoint || 'http://localhost:8080'} disabled />
          </div>
        )}
      </section>

      <div className="grid gap-14 border-t border-border pt-12 md:grid-cols-2 md:gap-10">
        <section>
          <div className="flex items-center gap-2">
            <Rocket className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-medium">Deploy to cloud</h3>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Deploy your AI server to Vercel for production use.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <DeployButton
              serverId={serverId}
              showUtilities={true}
              compact
              openTarget="vercel"
              openSignal={deployOpenSignal}
            />
            <Button variant="outline" size="sm" className="h-8 gap-2" onClick={copyApiKey}>
              {copiedKey ? (
                <CheckCircle2 className="size-4 text-emerald-500" />
              ) : (
                <Copy className="size-4" />
              )}
              Copy API key
            </Button>
          </div>
        </section>
        <section>
          <div className="flex items-center gap-2">
            <KeyRound className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-medium">Server API key</h3>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Clients must send this key in the{' '}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
              Authorization
            </code>{' '}
            header.
          </p>
          <div className="mt-5 flex items-center gap-2">
            <Input
              type={showApiKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onBlur={() => requestApiKeyChange(apiKey)}
              placeholder="sk-..."
              className="h-8 flex-1 font-mono text-xs"
            />
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => setShowApiKey((value) => !value)}
            >
              {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              onClick={copyApiKey}
              disabled={!apiKey}
            >
              {copiedKey ? (
                <CheckCircle2 className="size-4 text-emerald-500" />
              ) : (
                <Copy className="size-4" />
              )}
            </Button>
            <TooltipProvider delay={200}>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-8"
                      onClick={generateApiKey}
                      aria-label="Generate a new API key"
                    />
                  }
                >
                  <RefreshCw className="size-4" />
                </TooltipTrigger>
                <TooltipContent>Generate a new API key</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Stored locally in your browser. Generate a new key or paste your own.
          </p>
        </section>
      </div>

      <section className="mt-14 border-t border-border pt-10">
        <div className="flex items-center gap-2">
          <Globe className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">Cloud deployments</h3>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Each deployment exposes its API endpoint and interactive API reference.
        </p>
        {deployments.length > 0 ? (
          <div className="mt-5 overflow-hidden rounded-lg border">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b bg-muted/30 px-4 py-2 text-xs text-muted-foreground sm:grid-cols-[140px_minmax(0,1fr)_auto_auto]">
              <span className="hidden sm:block">Provider</span>
              <span>API endpoint</span>
              <span className="hidden sm:block">Reference</span>
              <span>Actions</span>
            </div>
            {deployments.map((deployment) => (
              <div
                key={deployment.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b bg-background px-4 py-3 last:border-b-0 sm:grid-cols-[140px_minmax(0,1fr)_auto_auto]"
              >
                <span className="hidden items-center gap-2 text-sm font-medium sm:flex">
                  {deployment.provider === 'vercel' ? (
                    <img src="/vercel.svg" alt="Vercel" className="size-3.5" />
                  ) : (
                    <Globe className="size-3.5" />
                  )}
                  {deployment.provider}
                  {deployment.status && (
                    <span
                      className={cn(
                        'rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium capitalize',
                        deployment.status === 'ready' &&
                          'border-green-500/20 bg-green-500/10 text-green-700 dark:text-green-400',
                        deployment.status === 'error' && 'bg-background text-foreground',
                        (deployment.status === 'building' || deployment.status === 'queued') &&
                          'border-orange-500/20 bg-orange-500/10 text-orange-700 dark:text-orange-400',
                      )}
                    >
                      {deployment.status}
                    </span>
                  )}
                  {(deployment.apiKeyVersion ?? 0) !== apiKeyVersion && (
                    <span className="rounded-sm border border-orange-500/20 bg-orange-500/10 px-1.5 py-0.5 text-[10px] font-medium text-orange-700 dark:text-orange-400">
                      Key redeploy required
                    </span>
                  )}
                </span>
                {editingDeploymentId === deployment.id ? (
                  <Input
                    value={editedDeploymentUrl}
                    onChange={(event) => setEditedDeploymentUrl(event.target.value)}
                    className="h-8 font-mono text-xs"
                    aria-label="Deployment URL"
                  />
                ) : (
                  <a
                    href={deploymentEndpoint(deployment)}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate font-mono text-xs hover:underline"
                  >
                    {deploymentUrl(deploymentEndpoint(deployment)).replace(/^https?:\/\//, '')}
                  </a>
                )}
                <ApiReferenceLink
                  url={deploymentEndpoint(deployment)}
                  project={deployment.project}
                />
                <div className="flex items-center gap-1">
                  {editingDeploymentId === deployment.id ? (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => {
                          try {
                            const url = new URL(editedDeploymentUrl).toString();
                            setDeployments(updateDeploymentUrl(serverId, deployment.id, url));
                            setEditingDeploymentId(null);
                          } catch {
                            toast.error('Enter a valid deployment URL.');
                          }
                        }}
                        aria-label="Save deployment URL"
                      >
                        <CheckCircle2 className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => setEditingDeploymentId(null)}
                        aria-label="Cancel editing deployment URL"
                      >
                        <X className="size-4" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <TooltipProvider delay={200}>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-8"
                                onClick={() => copyCloudApiKey(deployment.id)}
                                disabled={!apiKey}
                                aria-label="Copy cloud API key"
                              />
                            }
                          >
                            {copiedDeploymentId === deployment.id ? (
                              <CheckCircle2 className="size-4 text-emerald-500" />
                            ) : (
                              <Copy className="size-4" />
                            )}
                          </TooltipTrigger>
                          <TooltipContent>
                            {copiedDeploymentId === deployment.id
                              ? 'Cloud API key copied'
                              : (deployment.apiKeyVersion ?? 0) === apiKeyVersion
                              ? 'Copy cloud API key'
                              : 'Copy local key — redeploy to apply it'}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <ApiReferenceLink
                        url={deploymentEndpoint(deployment)}
                        project={deployment.project}
                        compact
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => {
                          setEditingDeploymentId(deployment.id);
                          setEditedDeploymentUrl(deploymentEndpoint(deployment));
                        }}
                        aria-label="Edit deployment URL"
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button variant="ghost" size="icon" className="size-8">
                              <MoreHorizontal className="size-4" />
                            </Button>
                          }
                        />
                        <DropdownMenuContent align="end" className={'w-[150px]'}>
                          {deployment.provider === 'vercel' && (
                            <DropdownMenuItem
                              onClick={() => {
                                const domain = deployment.url.replace(/^https?:\/\//, '');
                                window.open(`https://${domain}/_logs`, '_blank');
                              }}
                            >
                              <img
                                src="/vercel.svg"
                                alt="Vercel"
                                className="size-4 mr-2 dark:invert"
                              />
                              View in Vercel
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                            onClick={() =>
                              setDeployments(removeDeployment(serverId, deployment.id))
                            }
                          >
                            <Trash2 className="size-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col  border border-border rounded-md items-center px-4 py-6 justify-center gap-2 mt-5">
            <div className="bg-white p-1 border border-border rounded-md">
              <ServerIcon className="size-5" />
            </div>
            <p className=" rounded-lg text-sm text-muted-foreground text-center mx-auto">
              No cloud deployments yet. Deploy to a provider above to add one here.
            </p>
          </div>
        )}
      </section>

      <AlertDialog open={apiKeyChangeOpen} onOpenChange={setApiKeyChangeOpen}>
        <AlertDialogContent className={'max-w-xl! w-full!'}>
          <AlertDialogHeader>
            <AlertDialogTitle>Deploy this new API key?</AlertDialogTitle>
            <AlertDialogDescription>
              Existing cloud deployments keep their current key until you redeploy them. Choose
              whether to update locally only, or open a Vercel redeploy with this new key so your
              local and remote API keys stay in sync.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-3">
            <AlertDialogCancel
              className={'mr-auto'}
              size={'sm'}
              onClick={() => {
                setApiKey(localStorage.getItem('rag_server_api_key') || '');
                setPendingApiKey(null);
              }}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              size={'sm'}
              variant="ghost"
              onClick={() => confirmApiKeyChange(false)}
            >
              Update locally only
            </AlertDialogAction>
            <AlertDialogAction size={'sm'} onClick={() => confirmApiKeyChange(true)}>
              Update & deploy to Vercel
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
