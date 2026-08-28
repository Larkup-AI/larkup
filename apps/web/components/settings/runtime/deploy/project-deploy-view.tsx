'use client';

import { useState, useEffect, useMemo } from 'react';
import useSWR from 'swr';
import {
  Loader2,
  Eye,
  EyeOff,
  Dices,
  BadgeCheck,
  PlugZap,
  Wrench,
  FileText,
  Puzzle,
  ArrowLeft,
  Rocket,
  Plus,
  CopyIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTrigger,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
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
import { Textarea } from '@/components/ui/textarea';
import { StoreFields } from '@/components/configure/store-fields';
import { PROVIDER_META, ProviderIcon } from '@/components/ui/provider-icon';
import { EMBEDDING_MODELS } from '@larkup/core/embeddings/registry';
import {
  getVectorStore,
  validateStoreConfig,
  VECTOR_STORE_LIST,
} from '@larkup/vector-stores/registry';
import type { IndexType, RagConfig, VectorStoreId } from '@larkup/core/types';
import { SandboxSection } from '@/components/settings/general/sandbox-section';
import { BUILT_IN_TOOLS } from '@/lib/constants/tools';
import { STORE_META } from '@/lib/constants/stores';
import { getDeploymentTarget, saveDeploymentApiKey } from '@/lib/deployments';
import { useDeployCredentialsStore, useVpsTerminalStore } from '@/store/deploy-store';
import { VpsTerminalDialog, useVpsDeploy } from '.';

const fetcher = (url: string) => fetch(url).then((response) => response.json());

const CHAT_PROVIDER_OPTIONS = [
  'openai',
  'deepseek',
  'google',
  'mistral',
  'cohere',
  'vercel_ai_gateway',
] as const;

const DEFAULT_CHAT_MODELS: Record<(typeof CHAT_PROVIDER_OPTIONS)[number], string> = {
  openai: 'openai/gpt-4o-mini',
  deepseek: 'deepseek/deepseek-chat',
  google: 'google/gemini-3.6-flash',
  mistral: 'mistral/mistral-large-latest',
  cohere: 'cohere/command-r-plus',
  vercel_ai_gateway: 'openai/gpt-4o-mini',
};

function seedStoreConfig(storeId: VectorStoreId) {
  return getVectorStore(storeId).fields.reduce<Record<string, string>>((values, field) => {
    if (field.defaultValue) values[field.key] = field.defaultValue;
    return values;
  }, {});
}

function SelectionList<T>({
  items,
  selected,
  onChange,
  getId,
  getLabel,
  getDescription,
  getIcon,
  isPlugin,
  emptyState,
}: {
  items: T[];
  selected: string[];
  onChange: (s: string[]) => void;
  getId: (i: T) => string;
  getLabel: (i: T) => string;
  getDescription?: (i: T) => string;
  getIcon?: (i: T) => React.ElementType;
  isPlugin?: (i: T) => boolean;
  emptyState?: React.ReactNode;
}) {
  const toggleItem = (id: string) => {
    if (selected.includes(id)) onChange(selected.filter((i) => i !== id));
    else onChange([...selected, id]);
  };
  return (
    <div className="space-y-3">
      {items.length === 0 &&
        (emptyState ? (
          emptyState
        ) : (
          <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
            No items found.
          </p>
        ))}
      <div className="grid gap-3 sm:grid-cols-2 pb-4">
        {items.map((item) => {
          const Icon = getIcon ? getIcon(item) : null;
          const plugin = isPlugin ? isPlugin(item) : false;
          return (
            <div
              key={getId(item)}
              className="flex min-h-22 items-center gap-3 rounded-xl border bg-white/70 px-4 py-4 dark:bg-card/70"
            >
              <div className="flex shrink-0 h-10 w-10 items-center justify-center rounded-lg border bg-muted/40">
                {Icon ? (
                  <Icon className="w-4.5 h-4.5 text-muted-foreground" />
                ) : (
                  <div className="w-4.5 h-4.5" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-none">
                  {getLabel(item)}
                  {plugin && (
                    <span className="ml-2 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                      Plugin
                    </span>
                  )}
                </p>
                {getDescription && (
                  <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                    {getDescription(item)}
                  </p>
                )}
              </div>
              <Switch
                checked={selected.includes(getId(item))}
                onCheckedChange={() => toggleItem(getId(item))}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export interface ProjectDeployViewProps {
  target: string | null;
  serverId?: string;
  profile?: 'knowledge' | 'assistant';
  onSaved: () => void;
  onBack: () => void;
  /** Called after a deployment is accepted, before returning to the runtime view. */
  onDeployed?: () => void;
}

export function ProjectDeployView({
  target,
  serverId = 'default',
  profile: initialProfile,
  onSaved,
  onBack,
  onDeployed,
}: ProjectDeployViewProps) {
  const [step, setStep] = useState<'1' | '2'>('1');
  const [stepError, setStepError] = useState<'1' | '2' | null>(null);

  const [profile, setProfile] = useState<'knowledge' | 'assistant'>(initialProfile ?? 'knowledge');
  const deploymentTarget = getDeploymentTarget(target);
  const isServerlessTarget = deploymentTarget?.kind === 'serverless';

  // Storage State
  const configUrl = `/api/config`;
  const { data: source } = useSWR<{ config: RagConfig }>(configUrl, fetcher);
  const [storeId, setStoreId] = useState<VectorStoreId>('lancedb');
  const [storeConfig, setStoreConfig] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveStorageSettings, setSaveStorageSettings] = useState(true);
  const [embeddingModelId, setEmbeddingModelId] = useState('');
  const [chatProviderOverride, setChatProviderOverride] = useState('project');
  const [chatModelId, setChatModelId] = useState('');
  const [chatApiKey, setChatApiKey] = useState('');
  const [showChatApiKey, setShowChatApiKey] = useState(false);

  const [testing, setTesting] = useState(false);
  const [storeVerified, setStoreVerified] = useState(false);

  const [providerVerified, setProviderVerified] = useState(false);
  const [verifyingProvider, setVerifyingProvider] = useState(false);
  const [projectNotFoundName, setProjectNotFoundName] = useState<string | null>(null);

  // Agent State
  const [agentTab, setAgentTab] = useState('prompt');
  const [agentCustomizationOpen, setAgentCustomizationOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [sandboxProvider, setSandboxProvider] = useState('');
  const [enabledTools, setEnabledTools] = useState<string[]>([]);
  const [enabledMcp, setEnabledMcp] = useState<string[]>([]);
  const [enabledSkills, setEnabledSkills] = useState<string[]>([]);
  const [enabledPlugins, setEnabledPlugins] = useState<string[]>([]);

  // Env State
  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);

  // Provider State
  const [vercelToken, setVercelToken] = useState('');
  const [vercelProject, setVercelProject] = useState('');
  const [showToken, setShowToken] = useState(false);

  const [sshHost, setSshHost] = useState('');
  const [sshUsername, setSshUsername] = useState('root');
  const [sshAuthType, setSshAuthType] = useState<'key' | 'password'>('password');
  const [sshKeyOrPassword, setSshKeyOrPassword] = useState('');
  const [showSshPassword, setShowSshPassword] = useState(false);

  const [saving, setSaving] = useState(false);

  // VPS terminal state
  const vpsTerminal = useVpsTerminalStore();
  const { deployToVps } = useVpsDeploy(onSaved, onDeployed);

  // Persisted credential store
  const credStore = useDeployCredentialsStore();

  const { data: mcpData } = useSWR<{ connections: any[] }>('/api/mcp', fetcher);
  const { data: marketplaceData } = useSWR<{ tools: any[] }>('/api/marketplace', fetcher);

  const mcpConnections = mcpData?.connections || [];
  const installedPlugins = useMemo(() => {
    return (marketplaceData?.tools || []).filter((t) => t.status === 'installed');
  }, [marketplaceData]);

  // Init agent state + restore persisted credentials from Zustand store
  useEffect(() => {
    if (target === 'env') setStep('2');
    else setStep('1');
    setProfile(initialProfile ?? 'knowledge');
  }, [target, initialProfile]);

  useEffect(() => {
    // Sync the default SERVER_API_KEY from the local Larkup server instance
    const storedKey = window.localStorage.getItem('larkup-server-api-key');
    if (storedKey && !apiKey) setApiKey(storedKey);
  }, []);

  useEffect(() => {
    // Restore Vercel credentials (only if empty to avoid overwriting user edits)
    if (!vercelToken && credStore.vercelToken) setVercelToken(credStore.vercelToken);
    if (!vercelProject && credStore.vercelProject) setVercelProject(credStore.vercelProject);
  }, [credStore.vercelToken, credStore.vercelProject]);

  useEffect(() => {
    // Restore SSH credentials for this provider
    if (target && target !== 'env' && target !== 'Vercel') {
      const cred = credStore.sshCredentials[target];
      // Only auto-fill if the host is empty, meaning the user hasn't started typing
      if (cred && !sshHost) {
        setSshHost(cred.host ?? '');
        setSshUsername(cred.username ?? 'root');
        setSshAuthType(cred.authType ?? 'password');
        setSshKeyOrPassword(cred.credential ?? '');
      }
    }
  }, [target, credStore.sshCredentials]);

  useEffect(() => {
    if (!source?.config) return;
    const config = source.config;
    setPrompt(config.systemPrompt ?? '');
    setSandboxProvider(config.defaultSandboxProvider ?? 'local');
    setEnabledTools(
      config.enabledTools && config.enabledTools.length > 0
        ? config.enabledTools
        : BUILT_IN_TOOLS.map((t) => t.id),
    );
    if (config.skills) setEnabledSkills(config.skills.map((s) => s.id));

    const defaultStore = config.vectorStore === 'lancedb' ? 'lancedb' : config.vectorStore;
    setStoreId(defaultStore);
    setStoreConfig(
      config.vectorStore === defaultStore ? config.storeConfig : seedStoreConfig(defaultStore),
    );
    setEmbeddingModelId(config.embeddingModelId);
    setChatProviderOverride('project');
    setChatModelId(config.chatModelId ?? '');
    setChatApiKey('');

    // Restore cached storage config from Zustand store (overrides server defaults)
    const cachedStorage = credStore.deployStorage;
    if (cachedStorage.storeId) {
      setStoreId(cachedStorage.storeId as VectorStoreId);
      setStoreConfig(
        cachedStorage.storeConfig ?? seedStoreConfig(cachedStorage.storeId as VectorStoreId),
      );
    }
    if (cachedStorage.embeddingModelId) setEmbeddingModelId(cachedStorage.embeddingModelId);
  }, [source]);

  // Init dynamic lists to all enabled by default if not set
  useEffect(() => {
    if (mcpConnections.length > 0 && enabledMcp.length === 0)
      setEnabledMcp(mcpConnections.map((c) => c.id));
  }, [mcpConnections]);

  useEffect(() => {
    if (installedPlugins.length > 0 && enabledPlugins.length === 0)
      setEnabledPlugins(installedPlugins.map((p) => p.id));
  }, [installedPlugins]);

  const embeddingModels = useMemo(() => {
    if (!source?.config) return [];
    const provider = source.config.embeddingProvider;
    const configuredModels = EMBEDDING_MODELS.filter(
      (model) => provider === 'vercel_ai_gateway' || model.provider === provider,
    );
    const customModels = (source.config.customEmbeddings ?? []).map((model) => ({
      id: `custom:${model.modelName}`,
      label: model.modelName,
    }));
    const models = [...configuredModels, ...customModels];
    if (models.some((model) => model.id === source.config.embeddingModelId)) return models;
    return [
      { id: source.config.embeddingModelId, label: source.config.embeddingModelId },
      ...models,
    ];
  }, [source?.config]);
  const selectedEmbeddingModel =
    embeddingModels.find((model) => model.id === embeddingModelId) ?? embeddingModels[0];
  const projectChatProvider =
    source?.config.chatProvider || source?.config.embeddingProvider || 'openai';
  const selectedChatProvider =
    chatProviderOverride === 'project' ? projectChatProvider : chatProviderOverride;
  const selectedChatModel =
    chatProviderOverride === 'project'
      ? source?.config.chatModelId ||
        DEFAULT_CHAT_MODELS[selectedChatProvider as keyof typeof DEFAULT_CHAT_MODELS] ||
        DEFAULT_CHAT_MODELS.openai
      : chatModelId;
  const store = getVectorStore(storeId);
  const requiresCloudStorage = storeId === 'lancedb' && (storeConfig.mode ?? 'local') === 'local';

  function changeStore(nextStoreId: VectorStoreId) {
    setStoreId(nextStoreId);
    const seeded = seedStoreConfig(nextStoreId);
    setStoreConfig(seeded);
    setErrors({});
    setStoreVerified(false);
    // Persist immediately so the next open picks up the new store type
    const cached = JSON.parse(window.localStorage.getItem('larkup-deploy-storage') || '{}');
    window.localStorage.setItem(
      'larkup-deploy-storage',
      JSON.stringify({ ...cached, storeId: nextStoreId, storeConfig: seeded }),
    );
  }

  async function verifyStoreCredentials(): Promise<boolean> {
    if (!source?.config) return false;
    const fieldErrors = validateStoreConfig(
      store,
      storeConfig,
      source.config.indexType as IndexType,
    );
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      setStep('2');
      toast.error('Complete the required storage fields before verifying.', {
        position: 'bottom-left',
      });
      return false;
    }
    setTesting(true);
    try {
      const response = await fetch('/api/config/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...source.config,
          vectorStore: storeId,
          storeConfig,
          embeddingModelId,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        if (body.fieldErrors) setErrors(body.fieldErrors);
        throw new Error(body.error ?? 'Connection failed');
      }
      setStoreVerified(true);
      toast.success('Storage credentials verified.', { position: 'bottom-left' });
      return true;
    } catch (error) {
      setStoreVerified(false);
      const msg = error instanceof Error ? error.message : 'Connection failed';
      toast.error(msg, { position: 'bottom-left' });
      return false;
    } finally {
      setTesting(false);
    }
  }

  async function verifyDeployProvider(createProject = false) {
    setStepError(null);
    if (target === 'env') {
      setProviderVerified(true);
      setStep('2');
      return;
    }

    if (deploymentTarget?.id === 'Vercel') {
      if (!vercelToken || !vercelProject) {
        setStepError('1');
        toast.error('Please enter both a Vercel Token and a Project name.', {
          position: 'bottom-left',
        });
        return;
      }
    } else {
      if (!sshHost || !sshUsername || !sshKeyOrPassword) {
        setStepError('1');
        toast.error('Please fill in all SSH connection details.', { position: 'bottom-left' });
        return;
      }
    }

    setVerifyingProvider(true);
    try {
      const response = await fetch('/api/deploy/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: deploymentTarget?.id,
          createProject,
          credentials:
            deploymentTarget?.id === 'Vercel'
              ? { vercelToken, vercelProject }
              : { sshHost, sshUsername, sshAuthType, sshKeyOrPassword },
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        if (data.projectNotFound) {
          setProjectNotFoundName(vercelProject);
          return;
        }
        throw new Error(data.error || 'Verification failed');
      }
      setProjectNotFoundName(null);
      setProviderVerified(true);
      setStep('2');
      toast.success(
        data.created ? 'Project created and verified!' : 'Provider credentials verified!',
        { position: 'bottom-left' },
      );
    } catch (err: any) {
      setProviderVerified(false);
      toast.error(err.message || 'Failed to verify provider credentials', {
        position: 'bottom-left',
      });
    } finally {
      setVerifyingProvider(false);
    }
  }

  const handleGenerateKey = () => {
    const randomKey =
      'larkup-' +
      Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15);
    setApiKey(randomKey);
  };

  const handleCopyKey = () => {
    if (!apiKey) return;
    navigator.clipboard.writeText(apiKey);
    toast.success('API Key copied to clipboard');
  };

  async function handleDeploy() {
    setStepError(null);

    if (!providerVerified && target !== 'env') {
      setStep('1');
      return;
    }
    if (chatProviderOverride !== 'project' && (!chatModelId.trim() || !chatApiKey.trim())) {
      setStep('2');
      toast.error('Choose a chat model and provide an API key for the deployment provider.');
      return;
    }

    if (isServerlessTarget && requiresCloudStorage) {
      setStepError('2');
      toast.error(
        'Vercel uses ephemeral storage — local LanceDB data will not persist. Configure S3-compatible (LANCEDB_MODE=s3) or LanceDB Cloud (LANCEDB_MODE=cloud) storage before deploying to Vercel.',
        { position: 'bottom-left', duration: 8000 },
      );
      return;
    }

    if (!storeVerified) {
      const ok = await verifyStoreCredentials();
      if (!ok) {
        setStepError('2');
        return;
      }
    }

    // VPS targets use the streaming terminal dialog
    if (deploymentTarget && deploymentTarget.kind === 'vps') {
      const assistantOptions =
        profile === 'assistant'
          ? {
              systemPrompt: prompt,
              enabledTools,
              enabledMcp,
              enabledSkills,
              enabledPlugins,
              sandboxProvider: sandboxProvider || undefined,
            }
          : undefined;

      void deployToVps({
        provider: deploymentTarget.id,
        profile,
        assistantOptions,
        deployConfig: {
          vectorStore: storeId,
          storeConfig,
          embeddingModelId,
          ...(chatProviderOverride !== 'project'
            ? {
                chatProvider: selectedChatProvider,
                chatModelId: chatModelId.trim(),
                chatApiKey: chatApiKey.trim(),
              }
            : {}),
          saveStorageSettings,
          envValues,
          apiKey,
          credentials: { sshHost, sshUsername, sshAuthType, sshKeyOrPassword },
        },
      });
      return;
    }

    try {
      setSaving(true);
      const assistantOptions =
        profile === 'assistant'
          ? {
              systemPrompt: prompt,
              enabledTools,
              enabledMcp,
              enabledSkills,
              enabledPlugins,
              sandboxProvider: sandboxProvider || undefined,
            }
          : undefined;

      const deployConfig = {
        vectorStore: storeId,
        storeConfig,
        embeddingModelId,
        ...(chatProviderOverride !== 'project'
          ? {
              chatProvider: selectedChatProvider,
              chatModelId: chatModelId.trim(),
              chatApiKey: chatApiKey.trim(),
            }
          : {}),
        saveStorageSettings,
        envValues,
        apiKey,
        credentials:
          deploymentTarget?.id === 'Vercel'
            ? { vercelToken, vercelProject }
            : { sshHost, sshUsername, sshAuthType, sshKeyOrPassword },
      };

      const response = await fetch('/api/projects/deployments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: deploymentTarget?.id,
          profile,
          assistantOptions,
          deployConfig,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not save deployment.');
      if (apiKey && typeof body.deployment?.id === 'string') {
        saveDeploymentApiKey(body.deployment.id, apiKey);
      }
      toast.success('Deployment started. The remote URL has been added to this Project.');
      onSaved();
      if (onDeployed) onDeployed();
      else onBack();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save deployment.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col h-full w-full max-w-5xl mx-auto animate-in fade-in-0 duration-200 pb-20">
      {/* VPS live terminal dialog */}
      <VpsTerminalDialog
        targetLabel={deploymentTarget?.label ?? 'Server'}
        onPasswordSubmit={(newPassword) => {
          if (!deploymentTarget) return;
          const assistantOptions =
            profile === 'assistant'
              ? {
                  systemPrompt: prompt,
                  enabledTools,
                  enabledMcp,
                  enabledSkills,
                  enabledPlugins,
                  sandboxProvider: sandboxProvider || undefined,
                }
              : undefined;

          void deployToVps({
            provider: deploymentTarget.id,
            profile,
            assistantOptions,
            deployConfig: {
              vectorStore: storeId,
              storeConfig,
              embeddingModelId,
              ...(chatProviderOverride !== 'project'
                ? {
                    chatProvider: selectedChatProvider,
                    chatModelId: chatModelId.trim(),
                    chatApiKey: chatApiKey.trim(),
                  }
                : {}),
              saveStorageSettings,
              envValues,
              apiKey,
              credentials: { sshHost, sshUsername, sshAuthType, sshKeyOrPassword, newPassword },
            },
          });
        }}
        onClose={() => {
          if (vpsTerminal.state !== 'deploying') vpsTerminal.closeTerminal();
        }}
        onViewDeployment={() => {
          vpsTerminal.closeTerminal();
          if (onDeployed) onDeployed();
          else onBack();
        }}
      />

      <AlertDialog
        open={!!projectNotFoundName}
        onOpenChange={(open) => !open && setProjectNotFoundName(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Project Not Found</AlertDialogTitle>
            <AlertDialogDescription>
              The Vercel project &apos;{projectNotFoundName}&apos; does not exist. Would you like to
              create it now?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => verifyDeployProvider(true)}>
              Create Project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="flex items-center mb-8">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="-ml-2 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="mr-2 size-4" />
          Back to Server settings
        </Button>
      </div>

      <div className="space-y-1 mb-5">
        <div className="flex items-center gap-3">
          {deploymentTarget && (
            <span className="flex size-9 items-center justify-center rounded-lg border bg-muted/30">
              <img src={deploymentTarget.icon} alt="" className="size-5 object-contain" />
            </span>
          )}
          <h1 className="text-2xl font-bold tracking-tight">
            {target === 'env'
              ? 'Environment Settings'
              : `Deploy ${profile === 'assistant' ? 'Agent' : 'Knowledge'} to ${
                  deploymentTarget?.label ?? target
                }`}
          </h1>
        </div>
        <p className="text-muted-foreground">
          {target === 'env'
            ? 'Configure environment variables and storage.'
            : 'Configure your deployment settings before launching.'}
        </p>
      </div>

      <div className=" mt-5">
        {target !== 'env' && (
          <div className="flex items-center gap-6 mb-6 border-b pb-4">
            <div
              onClick={() => setStep('1')}
              className={`group flex items-center gap-2 cursor-pointer transition-colors ${
                step === '1' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <div
                className={`flex size-6 items-center justify-center rounded-full text-xs font-medium transition-colors ${
                  step === '1'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground group-hover:bg-muted/80 group-hover:text-foreground'
                }`}
              >
                1
              </div>
              <span className="text-sm font-medium">Provider Settings</span>
            </div>
            <div className="h-px w-8 bg-border" />
            <div
              onClick={() => setStep('2')}
              className={`group flex items-center gap-2 cursor-pointer transition-colors ${
                step === '2' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <div
                className={`flex size-6 items-center justify-center rounded-full text-xs font-medium transition-colors ${
                  step === '2'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground group-hover:bg-muted/80 group-hover:text-foreground'
                }`}
              >
                2
              </div>
              <span className="text-sm font-medium">Server Configuration</span>
            </div>
          </div>
        )}

        {/* Step 2: Server Configuration */}
        <div className={`mt-2 space-y-6 ${step !== '2' ? 'hidden' : 'block'}`}>
          {profile === 'assistant' && (
            <>
              <div className="space-y-4 rounded-xl border bg-white p-5 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold tracking-tight">Agent Customization</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Configure prompt, tools, plugins, skills, and MCP.
                  </p>
                </div>
                <Dialog
                  open={agentCustomizationOpen}
                  onOpenChange={(open) => {
                    setAgentCustomizationOpen(open);
                    if (!open)
                      toast.success(
                        'Agent customization changes have been saved for this deployment.',
                      );
                  }}
                >
                  <DialogTrigger className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/80 px-4 py-2 text-sm font-medium cursor-pointer">
                    Customize Agent
                  </DialogTrigger>
                  <DialogContent className="w-[90vw] h-[90vh] max-w-350 max-h-225 sm:max-w-[90vw] flex flex-col p-0">
                    <DialogHeader className="p-6 border-b pb-4">
                      <DialogTitle>Agent Customization</DialogTitle>
                      <DialogDescription>
                        Configure how your agent behaves in this deployment.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="flex-1 overflow-hidden flex flex-col p-5 pt-1 bg-white">
                      <Tabs
                        value={agentTab}
                        onValueChange={setAgentTab}
                        className="flex-1 flex flex-col h-full"
                      >
                        <TabsList className="flex items-center gap-1  rounded-lg bg-white/60 p-1 h-auto w-fit mb-1">
                          <TabsTrigger
                            value="prompt"
                            className="relative flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium transition-all duration-200 rounded-md data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:ring-1 data-[state=active]:ring-border data-[state=active]:shadow-sm text-muted-foreground hover:text-foreground hover:bg-muted/80 border-0 data-[state=inactive]:bg-transparent"
                          >
                            <FileText
                              className="size-3.5"
                              strokeWidth={agentTab === 'prompt' ? 2 : 1.75}
                            />
                            Prompt
                          </TabsTrigger>
                          <TabsTrigger
                            value="tools"
                            className="relative flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium transition-all duration-200 rounded-md data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:ring-1 data-[state=active]:ring-border data-[state=active]:shadow-sm text-muted-foreground hover:text-foreground hover:bg-muted/80 border-0 data-[state=inactive]:bg-transparent"
                          >
                            <Wrench
                              className="size-3.5"
                              strokeWidth={agentTab === 'tools' ? 2 : 1.75}
                            />
                            Tools & Plugins
                          </TabsTrigger>
                          <TabsTrigger
                            value="mcp"
                            className="relative flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium transition-all duration-200 rounded-md data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:ring-1 data-[state=active]:ring-border data-[state=active]:shadow-sm text-muted-foreground hover:text-foreground hover:bg-muted/80 border-0 data-[state=inactive]:bg-transparent"
                          >
                            <img src="/icons/mcp.svg" alt="" className="size-3.5 object-contain" />
                            MCP
                          </TabsTrigger>
                          <TabsTrigger
                            value="skills"
                            className="relative flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium transition-all duration-200 rounded-md data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:ring-1 data-[state=active]:ring-border data-[state=active]:shadow-sm text-muted-foreground hover:text-foreground hover:bg-muted/80 border-0 data-[state=inactive]:bg-transparent"
                          >
                            <img
                              src="/icons/agentskills.png"
                              alt=""
                              className="size-3.5 object-contain"
                            />
                            Skills
                          </TabsTrigger>
                        </TabsList>

                        <div className="flex-1 overflow-y-auto pr-2 pb-10">
                          <TabsContent value="prompt" className="m-0 border-0 p-0 h-full">
                            <div className="flex flex-col h-full gap-2.5">
                              <Label className="font-semibold text-[13px] text-foreground/90">
                                System Prompt
                              </Label>
                              <Textarea
                                value={prompt}
                                onChange={(event) => setPrompt(event.target.value)}
                                className="flex-1 text-sm bg-background/50 font-mono text-[13px] resize-none"
                                placeholder="You are a helpful assistant..."
                              />
                            </div>
                          </TabsContent>

                          <TabsContent value="tools" className="m-0 border-0 p-0">
                            <div className="space-y-8">
                              <div className="space-y-3">
                                <div className="flex items-center gap-2 mb-4">
                                  <Wrench className="size-4 text-muted-foreground" />
                                  <h2 className="text-sm font-medium">Built-in tools</h2>
                                </div>
                                <SelectionList
                                  items={BUILT_IN_TOOLS}
                                  selected={enabledTools}
                                  onChange={setEnabledTools}
                                  getId={(t) => t.id}
                                  getLabel={(t) => t.name}
                                  getDescription={(t) => t.description}
                                  getIcon={(t) => t.icon}
                                />
                              </div>
                              {installedPlugins.length > 0 && (
                                <div className="space-y-3">
                                  <div className="flex items-center gap-2 mb-4">
                                    <PlugZap className="size-4 text-muted-foreground" />
                                    <h2 className="text-sm font-medium">Marketplace plugins</h2>
                                  </div>
                                  <SelectionList
                                    items={installedPlugins}
                                    selected={enabledPlugins}
                                    onChange={setEnabledPlugins}
                                    getId={(p) => p.id}
                                    getLabel={(p) => p.name}
                                    getDescription={(p) => p.description}
                                    getIcon={() => Puzzle}
                                    isPlugin={() => true}
                                  />
                                </div>
                              )}
                            </div>
                          </TabsContent>

                          <TabsContent value="mcp" className="m-0 border-0 p-0">
                            <div className="space-y-3">
                              <div className="flex items-center gap-2 mb-4">
                                <img
                                  src="/icons/mcp.svg"
                                  alt=""
                                  className="size-4 object-contain"
                                />
                                <h2 className="text-sm font-medium">MCP Connections</h2>
                              </div>
                              <SelectionList
                                items={mcpConnections}
                                selected={enabledMcp}
                                onChange={setEnabledMcp}
                                getId={(c) => c.id}
                                getLabel={(c) => c.name}
                                getDescription={(c) => c.url}
                                emptyState={
                                  <div className="rounded-xl px-4 py-16 dark:bg-card/40">
                                    <div className="flex flex-col items-center gap-3">
                                      <div className="flex size-12 items-center justify-center rounded-xl border border-border dark:bg-secondary/70">
                                        <img
                                          src="/icons/mcp.svg"
                                          alt="MCP"
                                          className="size-7 object-contain"
                                        />
                                      </div>
                                      <div className="text-center">
                                        <h2 className="text-base font-semibold tracking-tight">
                                          No MCP connections yet
                                        </h2>
                                        <p className="mt-1 text-sm text-muted-foreground">
                                          Add a remote MCP endpoint to discover its tools.
                                        </p>
                                      </div>
                                      <AlertDialog>
                                        <AlertDialogTrigger
                                          render={<Button className="mt-2 gap-1.5" />}
                                        >
                                          <Plus className="size-4" /> Add MCP
                                        </AlertDialogTrigger>
                                        <AlertDialogContent>
                                          <AlertDialogHeader>
                                            <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
                                            <AlertDialogDescription>
                                              This action will navigate you to the Agent
                                              Customization page. Any unsaved changes in this
                                              deployment configuration will be lost. Do you want to
                                              continue?
                                            </AlertDialogDescription>
                                          </AlertDialogHeader>
                                          <AlertDialogFooter>
                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                            <AlertDialogAction
                                              onClick={() => {
                                                window.location.href =
                                                  '/settings?section=agent-customization';
                                              }}
                                            >
                                              Continue
                                            </AlertDialogAction>
                                          </AlertDialogFooter>
                                        </AlertDialogContent>
                                      </AlertDialog>
                                    </div>
                                  </div>
                                }
                              />
                            </div>
                          </TabsContent>

                          <TabsContent value="skills" className="m-0 border-0 p-0">
                            <div className="space-y-3">
                              <div className="flex items-center gap-2 mb-4">
                                <img
                                  src="/icons/agentskills.png"
                                  alt=""
                                  className="size-4 object-contain"
                                />
                                <h2 className="text-sm font-medium">Agent Skills</h2>
                              </div>
                              <SelectionList
                                items={source?.config.skills || []}
                                selected={enabledSkills}
                                onChange={setEnabledSkills}
                                getId={(s) => s.id}
                                getLabel={(s) => s.name}
                                getDescription={(s) => s.description}
                                emptyState={
                                  <div className="rounded-xl px-4 py-16 dark:bg-card/40">
                                    <div className="flex flex-col items-center gap-3">
                                      <div className="flex size-12 items-center justify-center rounded-xl border border-border dark:bg-secondary/70">
                                        <img
                                          src="/icons/agentskills.png"
                                          alt=""
                                          className="size-7 object-contain"
                                        />
                                      </div>
                                      <div className="text-center">
                                        <h2 className="text-base font-semibold tracking-tight">
                                          No skills added yet
                                        </h2>
                                        <p className="mt-1 text-sm text-muted-foreground">
                                          Import a SKILL.md or keep a canonical remote skill URL.
                                        </p>
                                      </div>
                                      <AlertDialog>
                                        <AlertDialogTrigger
                                          render={<Button className="mt-2 gap-1.5" />}
                                        >
                                          <Plus className="size-4" /> Add skill
                                        </AlertDialogTrigger>
                                        <AlertDialogContent>
                                          <AlertDialogHeader>
                                            <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
                                            <AlertDialogDescription>
                                              This action will navigate you to the Agent
                                              Customization page. Any unsaved changes in this
                                              deployment configuration will be lost. Do you want to
                                              continue?
                                            </AlertDialogDescription>
                                          </AlertDialogHeader>
                                          <AlertDialogFooter>
                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                            <AlertDialogAction
                                              onClick={() => {
                                                window.location.href =
                                                  '/settings?section=agent-customization';
                                              }}
                                            >
                                              Continue
                                            </AlertDialogAction>
                                          </AlertDialogFooter>
                                        </AlertDialogContent>
                                      </AlertDialog>
                                    </div>
                                  </div>
                                }
                              />
                            </div>
                          </TabsContent>
                        </div>
                      </Tabs>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>

              <SandboxSection embedded onProviderChange={(val) => setSandboxProvider(val)}>
                {['local', 'docker'].includes(sandboxProvider) && isServerlessTarget && (
                  <p className="text-[11px] font-medium text-orange-500 pl-1 mt-2">
                    Select a remote sandbox provider (for example E2B or Daytona) when deploying to{' '}
                    {deploymentTarget?.label}. Local and Docker runtimes are not available there.
                  </p>
                )}
              </SandboxSection>
            </>
          )}

          {/* Storage Config */}
          <div className="space-y-4 rounded-xl border bg-white p-5 ">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-sm font-semibold tracking-tight">Vector Storage</h3>
              <label className="flex items-center gap-2 text-xs font-medium cursor-pointer bg-muted/20 px-2.5 py-1 rounded-md border hover:bg-muted/40 transition-colors">
                <input
                  type="checkbox"
                  className="shrink-0 rounded-sm"
                  checked={saveStorageSettings}
                  onChange={(e) => setSaveStorageSettings(e.target.checked)}
                />
                Save storage settings
              </label>
            </div>
            <div className="space-y-4 pt-2">
              <p className="text-xs text-muted-foreground">
                Your selected vector store and embedding model are saved to this Project for later
                deployments. Persistent cloud stores reuse their indexed knowledge base without
                uploading or indexing it again.
              </p>
              <div className="flex items-center justify-between gap-3">
                <Select
                  value={storeId}
                  onValueChange={(value) => changeStore(value as VectorStoreId)}
                >
                  <SelectTrigger className="flex-1 bg-background">
                    <span className="flex items-center gap-2.5">
                      {STORE_META[storeId] && (
                        <ProviderIcon
                          src={STORE_META[storeId].iconSrc}
                          alt={store.label}
                          pillBg={STORE_META[storeId].pillBg}
                          size={16}
                        />
                      )}
                      <span className="font-medium text-sm">{store.label}</span>
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {VECTOR_STORE_LIST.map((candidate) => {
                      const meta = STORE_META[candidate.id];
                      const isComingSoon = candidate.installStatus === 'coming-soon';
                      return (
                        <SelectItem key={candidate.id} value={candidate.id} disabled={isComingSoon}>
                          <span className="flex items-center gap-2.5">
                            {meta && (
                              <ProviderIcon
                                src={meta.iconSrc}
                                alt={candidate.label}
                                pillBg={meta.pillBg}
                                size={16}
                              />
                            )}
                            <span className="font-medium text-sm">{candidate.label}</span>
                            {isComingSoon && (
                              <span className="ml-2 text-[9px] text-muted-foreground border rounded-full px-1.5">
                                Soon
                              </span>
                            )}
                          </span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>

                <Button
                  variant={storeVerified ? 'secondary' : 'outline'}
                  size="default"
                  className={'h-10.5'}
                  onClick={verifyStoreCredentials}
                  disabled={testing || requiresCloudStorage}
                >
                  {testing ? (
                    <Loader2 className="size-3.5 mr-2 animate-spin" />
                  ) : storeVerified ? (
                    <BadgeCheck className="size-3.5 mr-2 text-emerald-500" />
                  ) : (
                    <PlugZap className="size-3.5 mr-2" />
                  )}
                  {storeVerified ? 'Verified' : 'Verify'}
                </Button>
              </div>
              {requiresCloudStorage && (
                <p className="text-[11px] font-medium text-orange-500 pl-1 rounded-md  ">
                  You must select a cloud storage provider before deploying.
                </p>
              )}

              <div className="bg-muted/10 p-4 rounded-lg border">
                <StoreFields
                  store={store}
                  values={storeConfig}
                  errors={errors}
                  indexType={source?.config.indexType}
                  onChange={(key, value) => {
                    const next = { ...storeConfig, [key]: value };
                    setStoreConfig(next);
                    setErrors((cur) => ({ ...cur, [key]: '' }));
                    setStoreVerified(false);
                    // Persist updated fields
                    const cached = JSON.parse(
                      window.localStorage.getItem('larkup-deploy-storage') || '{}',
                    );
                    window.localStorage.setItem(
                      'larkup-deploy-storage',
                      JSON.stringify({ ...cached, storeId, storeConfig: next }),
                    );
                  }}
                />
                <div className="pt-4 border-t mt-4">
                  <h3 className="text-xs font-semibold mb-2 text-muted-foreground">
                    EMBEDDING MODEL
                  </h3>
                  <Select
                    value={embeddingModelId}
                    onValueChange={(value) => {
                      setEmbeddingModelId(value || '');
                      setStoreVerified(false);
                      // Persist embedding model choice
                      const cached = JSON.parse(
                        window.localStorage.getItem('larkup-deploy-storage') || '{}',
                      );
                      window.localStorage.setItem(
                        'larkup-deploy-storage',
                        JSON.stringify({ ...cached, embeddingModelId: value || '' }),
                      );
                    }}
                  >
                    <SelectTrigger className="w-full bg-background">
                      <span className="font-medium text-sm">
                        {selectedEmbeddingModel?.label ?? 'Default'}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      {embeddingModels.map((model) => (
                        <SelectItem key={model.id} value={model.id}>
                          <span className="font-medium text-sm">{model.label}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-4 rounded-xl border bg-white p-5">
            <div>
              <h3 className="text-sm font-semibold tracking-tight">AI chat runtime</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Choose the provider that will answer chat and Agent requests after deployment.
                Project settings are used by default.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Provider</Label>
                <Select
                  value={chatProviderOverride}
                  onValueChange={(value) => {
                    const nextProvider = value ?? 'project';
                    setChatProviderOverride(nextProvider);
                    if (nextProvider !== 'project') {
                      setChatModelId(
                        DEFAULT_CHAT_MODELS[nextProvider as keyof typeof DEFAULT_CHAT_MODELS] || '',
                      );
                      setChatApiKey('');
                    }
                  }}
                >
                  <SelectTrigger className="w-full bg-background">
                    <span className="flex items-center gap-2">
                      {PROVIDER_META[selectedChatProvider] && (
                        <ProviderIcon
                          src={PROVIDER_META[selectedChatProvider].iconSrc}
                          alt={PROVIDER_META[selectedChatProvider].label}
                          pillBg={PROVIDER_META[selectedChatProvider].pillBg}
                          size={16}
                        />
                      )}
                      <span>
                        {chatProviderOverride === 'project'
                          ? `Project default · ${
                              PROVIDER_META[selectedChatProvider]?.label ?? selectedChatProvider
                            }`
                          : PROVIDER_META[selectedChatProvider]?.label ?? selectedChatProvider}
                      </span>
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="project">
                      Project default ·{' '}
                      {PROVIDER_META[projectChatProvider]?.label ?? projectChatProvider}
                    </SelectItem>
                    {CHAT_PROVIDER_OPTIONS.map((provider) => {
                      const meta = PROVIDER_META[provider];
                      return (
                        <SelectItem key={provider} value={provider}>
                          <span className="flex items-center gap-2">
                            <ProviderIcon
                              src={meta.iconSrc}
                              alt={meta.label}
                              pillBg={meta.pillBg}
                              size={16}
                            />
                            {meta.label}
                          </span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Model ID</Label>
                <Input
                  value={selectedChatModel}
                  onChange={(event) => setChatModelId(event.target.value)}
                  disabled={chatProviderOverride === 'project'}
                  placeholder="openai/gpt-4o-mini"
                  className="bg-background font-mono text-xs"
                />
              </div>
            </div>
            {chatProviderOverride === 'project' ? (
              <p className="rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                This deployment inherits the configured{' '}
                {PROVIDER_META[selectedChatProvider]?.label ?? selectedChatProvider} key from
                General → AI Models and stores it as an encrypted provider environment value.
              </p>
            ) : (
              <div className="space-y-1.5">
                <Label className="text-xs">
                  {PROVIDER_META[selectedChatProvider]?.label ?? selectedChatProvider} API key
                </Label>
                <div className="relative">
                  <Input
                    type={showChatApiKey ? 'text' : 'password'}
                    value={chatApiKey}
                    onChange={(event) => setChatApiKey(event.target.value)}
                    placeholder="Paste a deployment-only API key"
                    autoComplete="off"
                    className="bg-background pr-10"
                  />
                  <button
                    type="button"
                    aria-label={showChatApiKey ? 'Hide chat API key' : 'Show chat API key'}
                    onClick={() => setShowChatApiKey((visible) => !visible)}
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
                  >
                    {showChatApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Used only for this deployment and sent to the provider as an encrypted environment
                  value.
                </p>
              </div>
            )}
          </div>

          <div className="space-y-4 rounded-xl border bg-white p-5 ">
            <h3 className="text-sm font-semibold tracking-tight border-b pb-3">
              Environment Variables
            </h3>
            <div className="grid gap-2 pt-2">
              <Label className="text-xs text-muted-foreground font-semibold">
                SERVER_API_KEY <span className="font-normal">(Optional)</span>
              </Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type={showApiKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="bg-background pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                <Button
                  className={'size-10'}
                  variant="outline"
                  size="icon"
                  onClick={handleCopyKey}
                  title="Copy Key"
                >
                  <CopyIcon className="size-4" />
                </Button>
                <Button
                  className={'size-10'}
                  variant="outline"
                  size="icon"
                  onClick={handleGenerateKey}
                  title="Generate new Key"
                >
                  <Dices className="size-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Step 1: Provider Settings */}
        <div className={`mt-2 space-y-6 ${step !== '1' ? 'hidden' : 'block'}`}>
          <div className="space-y-4 rounded-xl border bg-white p-5 ">
            {deploymentTarget?.id === 'Vercel' ? (
              <div className="space-y-4">
                <div className="grid gap-2">
                  <Label className="flex justify-between w-full items-center">
                    <span>
                      Vercel Token <span className="text-destructive ml-1">*</span>
                    </span>
                    <a
                      href="https://vercel.com/account/tokens"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[10px] font-medium text-muted-foreground underline hover:text-foreground"
                    >
                      Get token
                    </a>
                  </Label>
                  <div className="relative flex-1">
                    <Input
                      type={showToken ? 'text' : 'password'}
                      value={vercelToken}
                      onChange={(e) => {
                        setVercelToken(e.target.value);
                        credStore.setVercelToken(e.target.value);
                      }}
                      className="bg-background"
                    />
                    <button
                      type="button"
                      onClick={() => setShowToken(!showToken)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                    >
                      {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label>
                    Project Name <span className="text-destructive ml-1">*</span>
                  </Label>
                  <Input
                    value={vercelProject}
                    onChange={(e) => {
                      setVercelProject(e.target.value);
                      credStore.setVercelProject(e.target.value);
                    }}
                    className="bg-background"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid gap-2">
                  <Label>
                    {target} Host IP / Domain <span className="text-destructive ml-1">*</span>
                  </Label>
                  <Input
                    value={sshHost}
                    onChange={(e) => {
                      setSshHost(e.target.value);
                      if (target)
                        credStore.setSshCredential(target, {
                          host: e.target.value,
                          username: sshUsername,
                          authType: sshAuthType,
                          credential: sshKeyOrPassword,
                        });
                    }}
                    placeholder="e.g. 192.168.1.1 or myserver.com"
                    className="bg-background"
                  />
                </div>
                <div className="grid gap-2">
                  <Label>
                    SSH Username <span className="text-destructive ml-1">*</span>
                  </Label>
                  <Input
                    value={sshUsername}
                    onChange={(e) => {
                      setSshUsername(e.target.value);
                      if (target)
                        credStore.setSshCredential(target, {
                          host: sshHost,
                          username: e.target.value,
                          authType: sshAuthType,
                          credential: sshKeyOrPassword,
                        });
                    }}
                    placeholder="root"
                    className="bg-background"
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Authentication Type</Label>
                  <Select
                    value={sshAuthType}
                    onValueChange={(v) => {
                      const val = v as 'key' | 'password';
                      setSshAuthType(val);
                      if (target)
                        credStore.setSshCredential(target, {
                          host: sshHost,
                          username: sshUsername,
                          authType: val,
                          credential: sshKeyOrPassword,
                        });
                    }}
                  >
                    <SelectTrigger className="bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="password">Password</SelectItem>
                      <SelectItem value="key">Private Key</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>
                    {sshAuthType === 'password' ? 'SSH Password' : 'Private Key (PEM)'}{' '}
                    <span className="text-destructive ml-1">*</span>
                  </Label>
                  <div className="relative flex-1">
                    {sshAuthType === 'password' ? (
                      <Input
                        type={showSshPassword ? 'text' : 'password'}
                        value={sshKeyOrPassword}
                        onChange={(e) => {
                          setSshKeyOrPassword(e.target.value);
                          if (target)
                            credStore.setSshCredential(target, {
                              host: sshHost,
                              username: sshUsername,
                              authType: sshAuthType,
                              credential: e.target.value,
                            });
                        }}
                        className="bg-background"
                      />
                    ) : (
                      <Textarea
                        value={sshKeyOrPassword}
                        onChange={(e) => {
                          setSshKeyOrPassword(e.target.value);
                          if (target)
                            credStore.setSshCredential(target, {
                              host: sshHost,
                              username: sshUsername,
                              authType: sshAuthType,
                              credential: e.target.value,
                            });
                        }}
                        className="font-mono text-xs min-h-25 bg-background"
                        placeholder="-----BEGIN RSA PRIVATE KEY-----..."
                      />
                    )}
                    {sshAuthType === 'password' && (
                      <button
                        type="button"
                        onClick={() => setShowSshPassword(!showSshPassword)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                      >
                        {showSshPassword ? (
                          <EyeOff className="size-4" />
                        ) : (
                          <Eye className="size-4" />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="mt-12 flex justify-end gap-3 pt-6 border-t">
        {step === '1' ? (
          <>
            <Button variant="ghost" onClick={onBack} disabled={verifyingProvider}>
              Cancel
            </Button>
            <Button onClick={() => verifyDeployProvider(false)} disabled={verifyingProvider}>
              {verifyingProvider && <Loader2 className="mr-2 size-4 animate-spin" />}
              Verify Connection & Next
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              onClick={() => (target !== 'env' ? setStep('1') : onBack())}
              disabled={saving}
            >
              {target !== 'env' ? 'Back' : 'Cancel'}
            </Button>
            <Button onClick={handleDeploy} disabled={saving}>
              {saving ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Rocket className="mr-2 size-4" />
              )}
              Deploy Server
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
