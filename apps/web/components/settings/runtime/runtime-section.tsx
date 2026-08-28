'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import useSWR from 'swr';
import {
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  KeyRound,
  Loader2,
  Play,
  RefreshCw,
  Rocket,
  Square,
  Terminal,
  Server,
  Cable,
  CircleCheck,
  CircleDot,
  CircleX,
  Clock3,
  MessageSquare,
  Cloud,
  ServerIcon,
  Trash2,
  Pencil,
} from 'lucide-react';
import { toast } from 'sonner';
import type { RagConfig } from '@larkup/core/types';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { LineTabs } from '@/components/ui/line-tabs';
import { ConnectionsSection } from '@/components/settings/runtime/connections-tab';
import { ProjectDeployButton } from '@/components/settings/runtime/deploy/project-deploy-button';
import { ProjectDeployView } from '@/components/settings/runtime/deploy/project-deploy-view';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { getDeploymentTarget, readDeploymentApiKey, removeDeploymentApiKey } from '@/lib/deployments';

type RuntimeState = { running: boolean; endpoint: string; port: number; lastError?: string };
type Deployment = {
  id: string;
  name: string;
  provider: string;
  profile: 'knowledge' | 'assistant';
  endpoint: string;
  status: 'unknown' | 'queued' | 'building' | 'ready' | 'error' | 'canceled' | 'unavailable';
  statusMessage?: string;
};
type RuntimeTab = 'server' | 'connections' | 'deployments';
const fetcher = (url: string) => fetch(url).then((response) => response.json());
const EMPTY_DEPLOYMENTS: Deployment[] = [];

function sameStringRecord(left: Record<string, string>, right: Record<string, string>) {
  const leftEntries = Object.entries(left);
  return (
    leftEntries.length === Object.keys(right).length &&
    leftEntries.every(([key, value]) => right[key] === value)
  );
}

const DEPLOYMENT_STATUS = {
  unknown: { label: 'Not checked', className: 'text-muted-foreground', Icon: CircleDot },
  queued: { label: 'Queued', className: 'text-amber-600', Icon: Clock3 },
  building: { label: 'Building', className: 'text-amber-600', Icon: Loader2 },
  ready: { label: 'Ready', className: 'text-emerald-600', Icon: CircleCheck },
  error: { label: 'Failed', className: 'text-destructive', Icon: CircleX },
  canceled: { label: 'Canceled', className: 'text-destructive', Icon: CircleX },
  unavailable: { label: 'Unavailable', className: 'text-destructive', Icon: CircleX },
} as const;

function runtimeTabFromQuery(value: string | null, profile: 'knowledge' | 'assistant'): RuntimeTab {
  if (value === 'connections' || value === 'deployments' || value === 'server')
    return value as RuntimeTab;
  return 'server';
}

function createApiKey() {
  return `lk_${crypto.randomUUID().replaceAll('-', '')}`;
}

export function RunDeployAgentSection() {
  const {
    data: runtimeData,
    mutate: mutateRuntime,
    isLoading,
  } = useSWR<{ runtime: RuntimeState }>('/api/projects/runtime', fetcher, {
    refreshInterval: 10_000,
  });
  const { data: configData, mutate: mutateConfig } = useSWR<{ config: RagConfig }>(
    '/api/config',
    fetcher,
  );
  const { data: deploymentData, mutate: mutateDeployments } = useSWR<{ deployments: Deployment[] }>(
    '/api/projects/deployments',
    fetcher,
  );
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [profile, setProfile] = useState<'knowledge' | 'assistant'>('knowledge');
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);

  const [activeTab, setActiveTab] = useState<RuntimeTab>(() =>
    runtimeTabFromQuery(searchParams.get('tab'), 'knowledge'),
  );
  const [editingDeploymentId, setEditingDeploymentId] = useState<string | null>(null);
  const [deploymentEndpointDraft, setDeploymentEndpointDraft] = useState('');
  const [checkingDeploymentId, setCheckingDeploymentId] = useState<string | null>(null);
  const [removingDeploymentId, setRemovingDeploymentId] = useState<string | null>(null);
  const [deploymentToRemove, setDeploymentToRemove] = useState<Deployment | null>(null);
  const [deploymentApiKeys, setDeploymentApiKeys] = useState<Record<string, string>>({});
  const deployTarget = searchParams.get('deployTarget');

  useEffect(() => {
    setActiveTab(runtimeTabFromQuery(searchParams.get('tab'), profile));
  }, [profile, searchParams]);

  const setRuntimeTab = (tab: RuntimeTab) => {
    setActiveTab(tab);
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tab);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const setDeployTarget = (target: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (target) {
      params.set('deployTarget', target);
    } else {
      params.delete('deployTarget');
    }
    router.replace(`${pathname}?${params.toString()}`);
  };

  const completeDeployment = () => {
    setActiveTab('deployments');
    const params = new URLSearchParams(searchParams.toString());
    params.delete('deployTarget');
    params.set('tab', 'deployments');
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const [isOperating, setIsOperating] = useState(false);
  const state = runtimeData?.runtime;
  const running = state?.running ?? false;
  const endpoint = state?.endpoint ?? 'http://localhost:8080';
  // Keep the fallback reference stable. An inline `?? []` creates a new array
  // every render while SWR is loading, which makes the effect below run forever.
  const deployments = deploymentData?.deployments ?? EMPTY_DEPLOYMENTS;

  useEffect(() => {
    if (configData?.config.runtimeProfile) setProfile(configData.config.runtimeProfile);
  }, [configData]);
  useEffect(() => {
    const nextKeys = Object.fromEntries(
      deployments.flatMap((deployment) => {
        const key = readDeploymentApiKey(deployment.id);
        return key ? [[deployment.id, key]] : [];
      }),
    );
    setDeploymentApiKeys((current) => (sameStringRecord(current, nextKeys) ? current : nextKeys));
  }, [deployments]);
  useEffect(() => {
    const stored = window.localStorage.getItem('larkup-server-api-key');
    const value = stored || createApiKey();
    if (!stored) window.localStorage.setItem('larkup-server-api-key', value);
    setApiKey(value);
  }, []);
  function updateApiKey(value: string) {
    setApiKey(value);
    if (value) window.localStorage.setItem('larkup-server-api-key', value);
    else window.localStorage.removeItem('larkup-server-api-key');
  }
  function regenerateApiKey() {
    const value = createApiKey();
    updateApiKey(value);
    toast.success('A new local API key was generated.');
  }
  async function changeProfile(next: 'knowledge' | 'assistant') {
    if (running) {
      toast.error('Stop the server before switching between Knowledge and Agent modes.');
      return;
    }

    setProfile(next);
    if (!configData?.config) return;
    const response = await fetch('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...configData.config, runtimeProfile: next }),
    });
    if (response.ok) await mutateConfig();
    else toast.error('Could not save server profile.');
  }
  async function control(action: 'start' | 'stop') {
    setIsOperating(true);
    const key = action === 'start' ? apiKey || createApiKey() : '';
    if (action === 'start' && !apiKey) updateApiKey(key);
    const response = await fetch('/api/projects/runtime', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, apiKey: key || undefined }),
    });
    const result = await response.json();
    if (!response.ok) {
      toast.error(result.runtime?.lastError || result.error || `Could not ${action} the server.`);
      await mutateRuntime();
      setIsOperating(false);
      return;
    }
    toast.success(
      action === 'start' ? 'Server has started successfully.' : 'Server has stopped successfully.',
    );
    await mutateRuntime();
    setIsOperating(false);
  }
  async function copy(value: string, label: string) {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied.`);
  }
  async function check(id: string) {
    setCheckingDeploymentId(id);
    try {
      const vercelToken = window.localStorage.getItem('larkup-vercel-token') || undefined;
      const response = await fetch('/api/projects/deployments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkId: id, deployConfig: { credentials: { vercelToken } } }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not check this deployment.');
      await mutateDeployments();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not check this deployment.');
    } finally {
      setCheckingDeploymentId(null);
    }
  }
  useEffect(() => {
    const pendingVercelDeployments = deployments.filter(
      (deployment) =>
        deployment.provider === 'Vercel' &&
        (deployment.status === 'queued' || deployment.status === 'building'),
    );
    if (!pendingVercelDeployments.length || !window.localStorage.getItem('larkup-vercel-token'))
      return;
    const refresh = () =>
      void Promise.all(pendingVercelDeployments.map((deployment) => check(deployment.id)));
    refresh();
    const timer = window.setInterval(refresh, 5_000);
    return () => window.clearInterval(timer);
  }, [deployments]);
  async function updateDeploymentUrl(id: string) {
    const response = await fetch('/api/projects/deployments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updateId: id, endpoint: deploymentEndpointDraft }),
    });
    const body = await response.json();
    if (!response.ok) {
      toast.error(body.error || 'Could not update this deployment URL.');
      return;
    }
    setEditingDeploymentId(null);
    await mutateDeployments();
    toast.success('Deployment URL updated.');
  }
  async function removeDeployment() {
    if (!deploymentToRemove) return;
    setRemovingDeploymentId(deploymentToRemove.id);
    try {
      const response = await fetch('/api/projects/deployments', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: deploymentToRemove.id }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not remove this deployment.');
      removeDeploymentApiKey(deploymentToRemove.id);
      await mutateDeployments();
      toast.success('Deployment removed from this Project.');
      setDeploymentToRemove(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not remove this deployment.');
    } finally {
      setRemovingDeploymentId(null);
    }
  }
  async function copyDeploymentApiKey(deployment: Deployment) {
    const key = deploymentApiKeys[deployment.id];
    if (!key) {
      toast.error('This API key is only available in the browser that started the deployment.');
      return;
    }
    await copy(key, 'API key');
  }
  const curl = `curl -X POST ${endpoint}${
    profile === 'knowledge' ? '/query' : '/chat'
  } -H "Content-Type: application/json"${
    apiKey ? ` -H "Authorization: Bearer ${apiKey}"` : ''
  } -d '${
    profile === 'knowledge'
      ? '{"query":"hello"}'
      : '{"messages":[{"role":"user","content":"hello"}]}'
  }'`;
  const sdkApiKey = JSON.stringify(apiKey || 'YOUR_API_KEY');
  const sdkEndpoint = JSON.stringify(endpoint);
  const typeScriptSdkSnippet =
    profile === 'assistant'
      ? `/**
 * Larkup SDK quick start — Agent Server
 *
 * Agent Server: use LarkupAgentClient for tool-aware conversations.
 * Knowledge Server: use LarkupClient and client.query() for semantic retrieval.
 *
 * This server is in Agent mode, so the active example is below. The Knowledge
 * Server example is kept as a reference; use one client or the other.
 */
import { LarkupAgentClient } from '@larkup/sdk';

const agent = new LarkupAgentClient({
  baseUrl: ${sdkEndpoint},
  apiKey: ${sdkApiKey},
});

// Capabilities group tools by integration: built-ins, sandbox, each MCP server, and plugins.
for (const capability of await agent.capabilities()) {
  console.log(\`\${capability.name}: \${capability.tools.map((tool) => tool.name).join(', ')}\`);
}

// Read the saved UI prompt and enabled skill metadata from this runtime.
console.log((await agent.configuration()).systemPrompt);

// Discover the models this deployment can use. Gateway runtimes return all
// available providers; direct-provider runtimes return their configured choice.
const catalog = await agent.chatModelCatalog();
console.table(await agent.chatProviders());
const selectedModel = (await agent.chatModels('anthropic')).at(0);

// Ask the Agent to answer using its enabled tools and instructions.
console.log(await agent.chatText(selectedModel ? {
  messages: [{ role: 'user', content: 'What can you help me with?' }],
  provider: catalog.configuredProvider,
  modelId: selectedModel.id,
} : 'What can you help me with?'));

// Stream text deltas as the Agent generates them.
process.stdout.write('Agent: ');
for await (const text of agent.streamText('Give me a short welcome.')) {
  process.stdout.write(text);
}
process.stdout.write('\\n');

/* Knowledge Server alternative — use this only in Knowledge mode:
import { LarkupClient } from '@larkup/sdk';
const client = new LarkupClient({ baseUrl: ${sdkEndpoint}, apiKey: ${sdkApiKey} });
const result = await client.query('Find relevant documents', 5);
console.log(result.hits);
for await (const event of client.chat('Summarize the relevant documents.')) {
  if (event.type === 'text-delta') process.stdout.write(event.text ?? '');
}
*/`
      : `/**
 * Larkup SDK quick start — Knowledge Server
 *
 * Knowledge Server: use LarkupClient and client.query() for semantic retrieval.
 * Agent Server: use LarkupAgentClient and agent.chatText() for conversations.
 *
 * This server is in Knowledge mode, so the active example is below. The Agent
 * Server example is kept as a reference; use one client or the other.
 */
import { LarkupClient } from '@larkup/sdk';

const client = new LarkupClient({
  baseUrl: ${sdkEndpoint},
  apiKey: ${sdkApiKey},
});

// Retrieve the most relevant indexed chunks for a query.
const result = await client.query('Find relevant documents', 5);
console.log(result.hits);

// Inspect models, then optionally choose one for this chat request.
const catalog = await client.chatModelCatalog();
const selectedModel = (await client.chatModels('anthropic')).at(0);

// Stream a retrieval-grounded response as it is generated.
process.stdout.write('Answer: ');
for await (const event of client.chat(selectedModel ? {
  messages: [{ role: 'user', content: 'Summarize the relevant documents.' }],
  provider: catalog.configuredProvider,
  modelId: selectedModel.id,
} : 'Summarize the relevant documents.')) {
  if (event.type === 'text-delta') process.stdout.write(event.text ?? '');
}
process.stdout.write('\\n');

/* Agent Server alternative — use this only in Agent mode:
import { LarkupAgentClient } from '@larkup/sdk';
const agent = new LarkupAgentClient({ baseUrl: ${sdkEndpoint}, apiKey: ${sdkApiKey} });
for await (const text of agent.streamText('What can you help me with?')) {
  process.stdout.write(text);
}
*/`;
  const pythonSdkSnippet =
    profile === 'assistant'
      ? `"""
Larkup SDK quick start — Agent Server

Agent Server: use LarkupAgentClient for tool-aware conversations.
Knowledge Server: use LarkupClient and client.query() for semantic retrieval.

This server is in Agent mode, so the active example is below. The Knowledge
Server alternative is included as comments; use one client or the other.
"""
from larkup import LarkupAgentClient

agent = LarkupAgentClient(
    base_url=${sdkEndpoint},
    api_key=${sdkApiKey},
)

# Capabilities group tools by integration: built-ins, sandbox, each MCP server, and plugins.
for capability in agent.capabilities():
    print(capability.name, ", ".join(tool.name for tool in capability.tools))

# Read the saved UI prompt and enabled skill metadata from this runtime.
print(agent.configuration().systemPrompt)

# Discover models. Gateway runtimes return all available providers; direct
# provider runtimes return the configured provider and model.
catalog = agent.chat_model_catalog()
models = agent.chat_models("anthropic")

# Ask the Agent to answer using its enabled tools and instructions.
if models:
    from larkup import AgentChatRequest
    print(agent.chat_text(AgentChatRequest(
        messages=[{"role": "user", "content": "What can you help me with?"}],
        provider=catalog.configuredProvider,
        modelId=models[0].id,
    )))
else:
    print(agent.chat_text("What can you help me with?"))

# Stream text deltas as the Agent generates them.
for text in agent.stream_text("Give me a short welcome."):
    print(text, end="", flush=True)
print()

# Knowledge Server alternative — use this only in Knowledge mode:
# from larkup import LarkupClient, LarkupClientOptions
# client = LarkupClient(LarkupClientOptions(base_url=${sdkEndpoint}, api_key=${sdkApiKey}))
# result = client.query("Find relevant documents", top_k=5)
# print(result.hits)`
      : `"""
Larkup SDK quick start — Knowledge Server

Knowledge Server: use LarkupClient and client.query() for semantic retrieval.
Agent Server: use LarkupAgentClient and agent.chat_text() for conversations.

This server is in Knowledge mode, so the active example is below. The Agent
Server alternative is included as comments; use one client or the other.
"""
from larkup import LarkupClient, LarkupClientOptions

client = LarkupClient(LarkupClientOptions(
    base_url=${sdkEndpoint},
    api_key=${sdkApiKey},
))

# Retrieve the most relevant indexed chunks for a query.
result = client.query("Find relevant documents", top_k=5)
print(result.hits)

# Inspect models, then optionally choose one for this chat request.
catalog = client.chat_model_catalog()
models = client.chat_models("anthropic")

# Stream a retrieval-grounded response as it is generated.
from larkup import ChatRequest
request = ChatRequest(
    messages=[{"role": "user", "content": "Summarize the relevant documents."}],
    provider=catalog.configuredProvider if models else None,
    modelId=models[0].id if models else None,
)
for event in client.chat(request):
    if event.type == "text-delta":
        print(event.text or "", end="", flush=True)
print()

# Agent Server alternative — use this only in Agent mode:
# from larkup import LarkupAgentClient
# agent = LarkupAgentClient(base_url=${sdkEndpoint}, api_key=${sdkApiKey})
# for text in agent.stream_text("What can you help me with?"):
#     print(text, end="", flush=True)`;
  if (deployTarget) {
    return (
      <ProjectDeployView
        target={deployTarget}
        profile={profile}
        onSaved={() => void mutateDeployments()}
        onBack={() => setDeployTarget(null)}
        onDeployed={completeDeployment}
      />
    );
  }

  return (
    <section className="space-y-5">
      <AlertDialog
        open={Boolean(deploymentToRemove)}
        onOpenChange={(open) => !open && setDeploymentToRemove(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this deployment?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the saved deployment from this Project and clears its locally stored API
              key. It does not delete the remote deployment from its cloud provider.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(removingDeploymentId)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void removeDeployment()}
              disabled={Boolean(removingDeploymentId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {removingDeploymentId ? <Loader2 className="size-4 animate-spin" /> : 'Remove'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <div>
        <h1 className="text-xl font-semibold">Larkup Server</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Test locally, then deploy one retrieval and chat server anywhere.
        </p>
      </div>
      <LineTabs
        activeTab={activeTab}
        onTabChange={(tab) => setRuntimeTab(tab as RuntimeTab)}
        tabs={[
          { id: 'server', label: 'Server', icon: Server },
          { id: 'connections', label: 'Connections', icon: Cable },
          { id: 'deployments', label: 'Cloud deployments', icon: Cloud },
        ]}
        className="mb-6 pb-0"
      />

      {activeTab === 'server' && (
        <div className="pt-2 animate-in fade-in-0 duration-200">
          <div className="space-y-12">
            <section>
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <Terminal className="size-4 text-muted-foreground" />
                  <h2 className="text-base font-medium">Local server</h2>
                </div>
                <span
                  className={
                    running
                      ? 'flex items-center gap-2 text-sm font-medium text-emerald-600'
                      : 'flex items-center gap-2 text-sm text-muted-foreground'
                  }
                >
                  <span
                    className={
                      running
                        ? 'size-2 rounded-full bg-emerald-500'
                        : 'size-2 rounded-full bg-muted-foreground/40'
                    }
                  />
                  {running ? `running on :${state?.port}` : 'stopped'}
                </span>
              </div>
              <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
                Start the server locally to test your AI endpoints. Configuration and API keys are
                applied automatically.
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border bg-white/70 px-4 py-3.5 dark:bg-card/70">
                <div className="mr-auto flex items-center gap-2">
                  <span className="text-sm font-medium">
                    {profile === 'knowledge' ? 'Knowledge Server' : 'Agent Server'}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {profile === 'knowledge' ? 'retrieval API' : 'chat, tools & sandbox'}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">Knowledge</span>
                <Switch
                  checked={profile === 'assistant'}
                  aria-label="Run as Agent Server"
                  onCheckedChange={(checked) =>
                    void changeProfile(checked ? 'assistant' : 'knowledge')
                  }
                />
                <span className="text-xs text-muted-foreground">Agent</span>
              </div>
              {running ? (
                <div className="mt-5 space-y-4">
                  {/* <button
                    type="button"
                    onClick={() => void copy(endpoint, 'Server endpoint')}
                    className="flex w-full items-center justify-between gap-3 rounded-xl border bg-muted/20 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
                  >
                    <span className="flex min-w-0 items-center gap-2 font-mono text-sm">
                      <span className="rounded-md border bg-background p-1.5">
                        <Copy className="size-3.5" />
                      </span>
                      <span className="truncate">{endpoint}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">Click to copy</span>
                  </button> */}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void copy(typeScriptSdkSnippet, 'TypeScript SDK code')}
                      >
                        <Image
                          src="/icons/typescript.png"
                          alt=""
                          width={14}
                          height={14}
                          className="mr-1.5 size-3.5 object-contain"
                        />
                        Copy TypeScript SDK
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void copy(pythonSdkSnippet, 'Python SDK code')}
                      >
                        <Image
                          src="/icons/python.png"
                          alt=""
                          width={14}
                          height={14}
                          className="mr-1.5 size-3.5 object-contain"
                        />
                        Copy Python SDK
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void copy(curl, 'cURL command')}
                      >
                        <Terminal className="mr-1.5 size-3.5" />
                        Copy cURL
                      </Button>
                      <a
                        href={`${endpoint}/reference`}
                        target="_blank"
                        rel="noreferrer"
                        className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                      >
                        <ExternalLink className="mr-1.5 size-3.5" />
                        API reference
                      </a>
                    </div>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={isLoading || isOperating}
                      onClick={() => void control('stop')}
                    >
                      {isLoading || isOperating ? (
                        <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                      ) : (
                        <Square className="mr-1.5 size-3.5" />
                      )}
                      Stop server
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-5 flex gap-2">
                  <Button disabled={isLoading || isOperating} onClick={() => void control('start')}>
                    {isLoading || isOperating ? (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    ) : (
                      <Play className="mr-2 size-4" />
                    )}
                    Launch server
                  </Button>
                </div>
              )}
              {state?.lastError && (
                <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  {state.lastError}
                </p>
              )}
            </section>
            <div className="grid gap-10 border-t pt-10 md:grid-cols-2">
              <section>
                <div className="flex items-center gap-2">
                  <Rocket className="size-4 text-muted-foreground" />
                  <h2 className="text-base font-medium">Deploy to cloud</h2>
                </div>
                <p className="mt-3 text-sm text-muted-foreground">
                  Deploy your {profile === 'knowledge' ? 'Knowledge' : 'Agent'} Server for
                  production use.
                </p>
                <div className="mt-5 flex items-center gap-2">
                  <ProjectDeployButton
                    profile={profile}
                    onDeployClick={setDeployTarget}
                    onSaved={() => void mutateDeployments()}
                  />
                  <Button
                    variant="outline"
                    aria-label="Copy API key"
                    onClick={() => void copy(apiKey, 'API key')}
                    disabled={!apiKey}
                    className="px-3 h-9"
                  >
                    <Copy className="mr-2 size-4" />
                    Copy API key
                  </Button>
                </div>
              </section>
              <section>
                <div className="flex items-center gap-2">
                  <KeyRound className="size-4 text-muted-foreground" />
                  <h2 className="text-base font-medium">Server API key</h2>
                </div>
                <p className="mt-3 text-sm text-muted-foreground">
                  Clients must send this key in the{' '}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs">Authorization</code>{' '}
                  header.
                </p>
                <div className="mt-5 flex gap-2 items-center">
                  <Input
                    value={apiKey}
                    onChange={(event) => updateApiKey(event.target.value)}
                    type={showApiKey ? 'text' : 'password'}
                    placeholder="sk-..."
                    disabled={running}
                    className="font-mono text-xs bg-white dark:bg-background"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                    onClick={() => setShowApiKey((value) => !value)}
                    disabled={!apiKey}
                    className="shrink-0 size-10"
                  >
                    {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Regenerate API key"
                    onClick={regenerateApiKey}
                    disabled={running}
                    className="shrink-0 size-10"
                  >
                    <RefreshCw className="size-4" />
                  </Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {running
                    ? 'Stop the server before replacing this key.'
                    : 'Stored locally in this browser for testing. Generate a new key or paste your own.'}
                </p>
              </section>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'connections' && (
        <div className="pt-2 animate-in fade-in-0 duration-200">
          <ConnectionsSection embedded />
        </div>
      )}

      {activeTab === 'deployments' && (
        <div className="animate-in fade-in-0 duration-200">
          <section className="space-y-5">
            {deployments.length === 0 ? (
              <div className="mt-5 rounded-xl flex flex-col gap-3 items-center justify-center p-19 text-sm text-muted-foreground">
                <div className="border bg-white  rounded-md p-2">
                  <ServerIcon className="size-5" />
                </div>
                <h1 className="text-base font-medium">No remote deployments saved yet. </h1>
                <p className="mt-0 text-sm text-muted-foreground">
                  Each deployment exposes its API endpoint and interactive API reference. Deploy to
                  a cloud provider to get started.
                </p>
                <ProjectDeployButton
                  profile={profile}
                  onDeployClick={setDeployTarget}
                  onSaved={() => void mutateDeployments()}
                  compact
                />
              </div>
            ) : (
              <div className="mt-5 overflow-hidden rounded-xl border bg-white/70 dark:bg-card/70">
                <div className="hidden grid-cols-[200px_minmax(0,1fr)_auto_auto] gap-3 border-b bg-muted/30 px-4 py-2 text-xs text-muted-foreground sm:grid">
                  <span>Provider</span>
                  <span>API endpoint</span>
                  <span>Status</span>
                  <span>Actions</span>
                </div>
                {deployments.map((deployment) => (
                  <div
                    key={deployment.id}
                    className="flex flex-wrap items-center gap-3 border-b px-4 py-3 last:border-b-0 sm:grid sm:grid-cols-[200px_minmax(0,1fr)_auto_auto]"
                  >
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {getDeploymentTarget(deployment.provider) && (
                        <img
                          src={getDeploymentTarget(deployment.provider)!.icon}
                          alt=""
                          className="size-4 object-contain"
                        />
                      )}
                      {deployment.provider} ·{' '}
                      {deployment.profile === 'knowledge' ? 'Knowledge' : 'Agent'}
                    </span>
                    {editingDeploymentId === deployment.id ? (
                      <Input
                        value={deploymentEndpointDraft}
                        onChange={(event) => setDeploymentEndpointDraft(event.target.value)}
                        aria-label={`Deployment URL for ${deployment.provider}`}
                        className="h-8 min-w-0 font-mono text-xs"
                      />
                    ) : (
                      <div className="flex min-w-0 items-center gap-1">
                        <a
                          href={deployment.endpoint}
                          target="_blank"
                          rel="noreferrer"
                          className="min-w-0 max-w-37.5 lg:max-w-75 truncate font-mono text-xs hover:underline"
                        >
                          {deployment.endpoint}
                        </a>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 shrink-0"
                          aria-label={`Copy API endpoint for ${deployment.provider} deployment`}
                          title="Copy API endpoint"
                          onClick={() => void copy(deployment.endpoint, 'API endpoint')}
                        >
                          <Copy className="size-3.5" />
                        </Button>
                      </div>
                    )}
                    {(() => {
                      const meta = DEPLOYMENT_STATUS[deployment.status];
                      const Icon = meta.Icon;
                      return (
                        <div className="min-w-0">
                          <span className={`flex items-center gap-1.5 text-xs ${meta.className}`}>
                            <Icon
                              className={`size-3.5 ${
                                deployment.status === 'building' ? 'animate-spin' : ''
                              }`}
                            />
                            <span>{meta.label}</span>
                          </span>
                        </div>
                      );
                    })()}
                    <TooltipProvider>
                      <div className="flex items-center gap-2">
                        {editingDeploymentId === deployment.id ? (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void updateDeploymentUrl(deployment.id)}
                            >
                              Save URL
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditingDeploymentId(null)}
                            >
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <>
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-8"
                                    onClick={() => {
                                      setEditingDeploymentId(deployment.id);
                                      setDeploymentEndpointDraft(deployment.endpoint);
                                    }}
                                    aria-label="Update URL"
                                  >
                                    <Pencil className="size-3.5" />
                                  </Button>
                                }
                              />
                              <TooltipContent>Update URL</TooltipContent>
                            </Tooltip>

                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-8"
                                    aria-label={`Copy API key for ${deployment.provider} deployment`}
                                    onClick={() => void copyDeploymentApiKey(deployment)}
                                    disabled={!deploymentApiKeys[deployment.id]}
                                  >
                                    <KeyRound className="size-3.5" />
                                  </Button>
                                }
                              />
                              <TooltipContent>
                                {deploymentApiKeys[deployment.id]
                                  ? 'Copy API key'
                                  : 'API key is available only in the browser that started this deployment'}
                              </TooltipContent>
                            </Tooltip>

                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-8"
                                    onClick={() => void check(deployment.id)}
                                    disabled={checkingDeploymentId === deployment.id}
                                    aria-label="Check Status"
                                  >
                                    {checkingDeploymentId === deployment.id ? (
                                      <Loader2 className="size-3.5 animate-spin" />
                                    ) : (
                                      <RefreshCw className="size-3.5" />
                                    )}
                                  </Button>
                                }
                              />
                              <TooltipContent>Check Status</TooltipContent>
                            </Tooltip>

                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-8 text-destructive hover:text-destructive"
                                    aria-label={`Remove ${deployment.provider} deployment`}
                                    onClick={() => setDeploymentToRemove(deployment)}
                                  >
                                    <Trash2 className="size-3.5" />
                                  </Button>
                                }
                              />
                              <TooltipContent>Remove deployment</TooltipContent>
                            </Tooltip>
                          </>
                        )}
                      </div>
                    </TooltipProvider>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
