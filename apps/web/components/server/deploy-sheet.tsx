'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import useSWR from 'swr';
import {
  Rocket,
  Loader2,
  Eye,
  EyeOff,
  CheckCircle2,
  Dices,
  Copy,
  ShieldAlert,
  AlertTriangle,
  BadgeCheck,
  Clock,
  PlugZap,
  Upload,
  ChevronDown,
  Settings2,
  Cloud,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { StoreFields } from '@/components/configure/store-fields';
import { ProviderIcon } from '@/components/ui/provider-icon';
import { useWorkspace } from '@/components/workspace/workspace-provider';
import { EMBEDDING_MODELS } from '@larkup/core/embeddings/registry';
import {
  getVectorStore,
  validateStoreConfig,
  VECTOR_STORE_LIST,
} from '@larkup/vector-stores/registry';
import type { IndexType, RagConfig, VectorStoreId } from '@larkup/core/types';
import { deployToVercel, getServerEnvRequirements } from '@/app/actions/vercel';
import { incrementApiKeyVersion, saveDeployment } from '@/lib/deployments';

const GLOBAL_TOKEN_KEY = 'vercel_token';
function projectKey(serverId: string) {
  return `vercel_project_${serverId}`;
}
function deployedUrlKey(serverId: string) {
  return `vercel_deployed_url_${serverId}`;
}
function deployedProviderKey(serverId: string) {
  return `vercel_deployed_provider_${serverId}`;
}
function serverEnvKey(serverId: string) {
  return `rag_server_env_vars_${serverId}`;
}

function persistApiKey(serverId: string, apiKey: string) {
  const previousKey = localStorage.getItem('rag_server_api_key') || '';
  if (apiKey !== previousKey) incrementApiKeyVersion(serverId);
  if (apiKey) localStorage.setItem('rag_server_api_key', apiKey);
  else localStorage.removeItem('rag_server_api_key');
}

const fetcher = (url: string) => fetch(url).then((response) => response.json());

type IndexRun = {
  status: string;
  totalChunks: number;
  processedChunks: number;
  warning?: string;
  error?: string;
};

const STORE_META: Record<string, { iconSrc: string; pillBg: string }> = {
  lancedb: { iconSrc: '/icons/lancedb2.png', pillBg: 'bg-yellow-50 dark:bg-yellow-950/40' },
  pinecone: { iconSrc: '/icons/pinecone.png', pillBg: 'bg-green-50 dark:bg-green-950/40' },
};

function seedStoreConfig(storeId: VectorStoreId) {
  return getVectorStore(storeId).fields.reduce<Record<string, string>>((values, field) => {
    if (field.defaultValue) values[field.key] = field.defaultValue;
    return values;
  }, {});
}

export interface DeploySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: string | null;
  serverId: string;
}

export function DeploySheet({ open, onOpenChange, target, serverId }: DeploySheetProps) {
  const { refresh, activateServer } = useWorkspace();
  const [activeTab, setActiveTab] = useState<'general' | 'provider'>('general');
  const [tabError, setTabError] = useState<'general' | 'provider' | null>(null);

  // Storage State
  const configUrl = `/api/config?serverId=${encodeURIComponent(serverId)}`;
  const { data: source } = useSWR<{ config: RagConfig }>(open ? configUrl : null, fetcher);
  const [storeId, setStoreId] = useState<VectorStoreId>('lancedb');
  const [storeConfig, setStoreConfig] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [copyKnowledgeBase, setCopyKnowledgeBase] = useState(true);
  const [testing, setTesting] = useState(false);
  const [credentialsVerified, setCredentialsVerified] = useState(false);
  const [embeddingModelId, setEmbeddingModelId] = useState('');
  const [creating, setCreating] = useState(false);
  const [newServerId, setNewServerId] = useState<string | null>(null);
  const [isConfigOpen, setIsConfigOpen] = useState(true);
  const [storageVerificationError, setStorageVerificationError] = useState<string | null>(null);
  const [autoDeployPending, setAutoDeployPending] = useState(false);
  const lastWarning = useRef<string | undefined>(undefined);

  // Env State
  const [requiredEnv, setRequiredEnv] = useState<
    { key: string; help: string; required: boolean; defaultValue?: string }[]
  >([]);
  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [showEnvVars, setShowEnvVars] = useState<Record<string, boolean>>({});
  const [hasInitializedEnv, setHasInitializedEnv] = useState(false);
  const [envRequirementsReady, setEnvRequirementsReady] = useState(false);

  // Provider State
  const [vercelToken, setVercelToken] = useState('');
  const [vercelProject, setVercelProject] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [tokenWasSaved, setTokenWasSaved] = useState(false);

  const [sshHost, setSshHost] = useState('');
  const [sshUsername, setSshUsername] = useState('root');
  const [sshAuthType, setSshAuthType] = useState<'key' | 'password'>('password');
  const [sshKeyOrPassword, setSshKeyOrPassword] = useState('');
  const [showSshPassword, setShowSshPassword] = useState(false);
  const [sshLogs, setSshLogs] = useState<string[]>([]);
  const [passwordChangeOpen, setPasswordChangeOpen] = useState(false);
  const [newSshPassword, setNewSshPassword] = useState('');
  const [confirmNewSshPassword, setConfirmNewSshPassword] = useState('');
  const [showNewSshPassword, setShowNewSshPassword] = useState(false);
  const [showConfirmSshPassword, setShowConfirmSshPassword] = useState(false);

  const [isDeploying, setIsDeploying] = useState(false);
  const pendingDeployRef = useRef<any>(null);

  const activeServerId = newServerId ?? serverId;

  const { data: indexData } = useSWR<{ run: IndexRun | null }>(
    newServerId ? `/api/index?serverId=${encodeURIComponent(newServerId)}` : null,
    fetcher,
    {
      refreshInterval: (data) =>
        data?.run && !['completed', 'failed'].includes(data.run.status) ? 1200 : 0,
    },
  );
  const run = indexData?.run;
  const isIndexing = Boolean(run && !['completed', 'failed'].includes(run.status));
  const progress = useMemo(
    () => (run?.totalChunks ? Math.round((run.processedChunks / run.totalChunks) * 100) : 5),
    [run],
  );

  useEffect(() => {
    if (!open) {
      setHasInitializedEnv(false);
      setEnvRequirementsReady(false);
      setNewServerId(null);
      setAutoDeployPending(false);
      setIsDeploying(false);
      setTabError(null);
      if (target === 'env') setActiveTab('general');
    } else {
      if (target === 'env') setActiveTab('general');
      else setActiveTab('provider');
    }
  }, [open, target]);

  useEffect(() => {
    if (run?.warning && run.warning !== lastWarning.current) {
      toast.warning(run.warning, {
        id: 'cloud-index-rate-limit',
        duration: 70_000,
        position: 'bottom-left',
      });
    }
    lastWarning.current = run?.warning;
  }, [run?.warning]);

  useEffect(() => {
    if (!source?.config || newServerId || hasInitializedEnv) return;
    const config = source.config;
    const defaultStore = config.vectorStore === 'lancedb' ? 'lancedb' : config.vectorStore;
    setStoreId(defaultStore);
    setStoreConfig(
      config.vectorStore === defaultStore ? config.storeConfig : seedStoreConfig(defaultStore),
    );
    setEmbeddingModelId(config.embeddingModelId);

    getServerEnvRequirements(serverId).then((reqs) => {
      setRequiredEnv(reqs);
      const savedEnvStr = localStorage.getItem(serverEnvKey(serverId));
      const savedEnv = savedEnvStr ? JSON.parse(savedEnvStr) : {};
      const initialVals: Record<string, string> = {};
      for (const req of reqs) initialVals[req.key] = savedEnv[req.key] || req.defaultValue || '';
      setEnvValues(initialVals);

      const savedToken = localStorage.getItem(GLOBAL_TOKEN_KEY);
      const savedProject = localStorage.getItem(projectKey(serverId));
      const savedApiKey = localStorage.getItem('rag_server_api_key');
      if (savedApiKey) setApiKey(savedApiKey);
      if (savedToken) {
        setVercelToken(savedToken);
        setTokenWasSaved(true);
      }
      if (savedProject) setVercelProject(savedProject);

      setHasInitializedEnv(true);
      setEnvRequirementsReady(true);
    });
  }, [source, newServerId, hasInitializedEnv, serverId]);

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
  const store = getVectorStore(storeId);
  const requiresCloudStorage = storeId === 'lancedb' && (storeConfig.mode ?? 'local') === 'local';

  // Cloud project tracking to auto-deploy
  useEffect(() => {
    if (autoDeployPending && run?.status === 'completed' && newServerId) {
      setAutoDeployPending(false);
      if (target === 'vercel') void actuallyDeployToVercel(newServerId);
      else if (target !== 'env') void actuallyDeployToSSH(newServerId);
    }
  }, [run?.status, autoDeployPending, newServerId, target]);

  function changeStore(nextStoreId: VectorStoreId) {
    setStoreId(nextStoreId);
    setStoreConfig(seedStoreConfig(nextStoreId));
    setErrors({});
    setCredentialsVerified(false);
  }

  async function verifyCredentials(): Promise<boolean> {
    if (!source?.config) return false;
    const fieldErrors = validateStoreConfig(
      store,
      storeConfig,
      source.config.indexType as IndexType,
    );
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      setIsConfigOpen(true);
      setActiveTab('general');
      toast.error('Complete the required storage fields before verifying.', {
        position: 'bottom-left',
      });
      return false;
    }
    setTesting(true);
    setStorageVerificationError(null);
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
        if (body.fieldErrors) {
          setErrors(body.fieldErrors);
          setIsConfigOpen(true);
        }
        throw new Error(body.error ?? 'Connection failed');
      }
      setCredentialsVerified(true);
      toast.success('Storage credentials verified.', { position: 'bottom-left' });
      return true;
    } catch (error) {
      setCredentialsVerified(false);
      const msg = error instanceof Error ? error.message : 'Connection failed';
      setStorageVerificationError(msg);
      toast.error(msg, { position: 'bottom-left' });
      return false;
    } finally {
      setTesting(false);
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
    if (apiKey) {
      navigator.clipboard.writeText(apiKey);
      toast.success('Server API Key copied.', { position: 'bottom-left' });
    }
  };

  async function createCloudProject(): Promise<string | null> {
    if (!source?.config || requiresCloudStorage) {
      toast.error('Choose cloud storage before continuing.', { position: 'bottom-left' });
      return null;
    }
    if (!credentialsVerified && !(await verifyCredentials())) return null;
    setCreating(true);
    try {
      const response = await fetch('/api/deploy/cloud-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceServerId: serverId,
          vectorStore: storeId,
          storeConfig,
          indexType: source.config.indexType,
          copyKnowledgeBase,
          embeddingModelId,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setErrors(body.fieldErrors ?? {});
        throw new Error(body.error ?? 'Could not create cloud project.');
      }
      setNewServerId(body.server.id);
      await refresh();
      toast.success(
        body.copiedDocuments ? 'Knowledge base indexing started...' : 'Cloud project created.',
        { position: 'bottom-left' },
      );
      return body.server.id;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create cloud project.', {
        position: 'bottom-left',
      });
      return null;
    } finally {
      setCreating(false);
    }
  }

  async function handleDeploy() {
    if (target === 'env') {
      // Just save environment
      persistApiKey(serverId, apiKey);
      localStorage.setItem(serverEnvKey(serverId), JSON.stringify(envValues));
      onOpenChange(false);
      toast.success('Environment configuration saved.', { position: 'bottom-left' });
      return;
    }

    setTabError(null);

    // Validate Provider Settings
    if (target === 'vercel') {
      if (!vercelToken || !vercelProject) {
        setActiveTab('provider');
        setTabError('provider');
        toast.error('Please enter both a Vercel Token and a Project name.', {
          position: 'bottom-left',
        });
        return;
      }
    } else {
      if (!sshHost || !sshUsername || !sshKeyOrPassword) {
        setActiveTab('provider');
        setTabError('provider');
        toast.error('Please fill in all SSH connection details.', { position: 'bottom-left' });
        return;
      }
    }

    // Validate Environment Settings
    for (const req of requiredEnv) {
      if (req.required && !envValues[req.key]) {
        setActiveTab('general');
        setTabError('general');
        toast.error(`Please provide a value for ${req.key}.`, { position: 'bottom-left' });
        return;
      }
    }

    // Validate Storage Settings
    if (requiresCloudStorage) {
      setActiveTab('general');
      setTabError('general');
      toast.error('You must configure a cloud vector store (e.g. Pinecone) to deploy.', {
        position: 'bottom-left',
      });
      return;
    }

    if (!credentialsVerified) {
      const ok = await verifyCredentials();
      if (!ok) {
        setActiveTab('general');
        setTabError('general');
        return;
      }
    }

    if (!newServerId && source?.config.vectorStore === 'lancedb' && storeId !== 'lancedb') {
      // Need cloud project mapping
      const createdId = await createCloudProject();
      if (createdId) setAutoDeployPending(true);
      return;
    }

    if (target === 'vercel') void actuallyDeployToVercel(newServerId ?? serverId);
    else void actuallyDeployToSSH(newServerId ?? serverId, undefined);
  }

  async function actuallyDeployToVercel(sid: string) {
    setIsDeploying(true);
    toast.info('Triggering deployment started !!', { position: 'bottom-left' });
    try {
      const finalEnvVars = { ...envValues };
      if (apiKey) {
        finalEnvVars['SERVER_API_KEY'] = apiKey;
        persistApiKey(sid, apiKey);
      }
      const res = await deployToVercel(vercelToken, vercelProject, sid, finalEnvVars);
      if (res.success) {
        localStorage.setItem(GLOBAL_TOKEN_KEY, vercelToken);
        localStorage.setItem(projectKey(sid), vercelProject);
        localStorage.setItem(deployedUrlKey(sid), res.url!);
        localStorage.setItem(deployedProviderKey(sid), 'vercel');
        saveDeployment(sid, {
          provider: 'vercel',
          project: res.projectName ?? vercelProject,
          url: res.url!,
          status: res.status,
        });
        if (sid !== serverId) await activateServer(sid);
        const title = res.projectCreated
          ? 'Project created and will be available in a few seconds'
          : 'Server has been deployed successfully!';
        toast.success(
          <div className="flex flex-col gap-1">
            <span>{title}</span>
            {/* {res.url && (
              <a
                href={res.url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-medium hover:text-blue-500"
              >
                View on Vercel ↗
              </a>
            )} */}
          </div>,
          { position: 'bottom-left' },
        );
        onOpenChange(false);
      } else {
        toast.error(res.error || 'Failed to deploy files to Vercel.', { position: 'bottom-left' });
      }
    } catch (e: any) {
      toast.error(e.message || 'An unexpected error occurred.', { position: 'bottom-left' });
    } finally {
      setIsDeploying(false);
    }
  }

  async function actuallyDeployToSSH(sid: string, overrideNewPassword?: string) {
    setIsDeploying(true);
    toast.info('Connecting to server and deploying via SSH...', {
      duration: 10000,
      position: 'bottom-left',
    });
    const deployHost = pendingDeployRef.current?.host || sshHost;
    const deployUser = pendingDeployRef.current?.username || sshUsername;
    const deployAuth = pendingDeployRef.current?.auth || {
      type: sshAuthType,
      value: sshKeyOrPassword,
    };
    const deployEnv =
      pendingDeployRef.current?.envVars ||
      (() => {
        const finalEnvVars = { ...envValues };
        if (apiKey) {
          finalEnvVars['SERVER_API_KEY'] = apiKey;
          persistApiKey(sid, apiKey);
        }
        return finalEnvVars;
      })();

    try {
      const bodyPayload: Record<string, any> = {
        serverId: sid,
        host: deployHost,
        username: deployUser,
        privateKeyOrPassword: deployAuth,
        envVars: deployEnv,
      };
      if (overrideNewPassword) bodyPayload.newPassword = overrideNewPassword;
      const response = await fetch('/api/deploy/ssh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload),
      });
      if (!response.body) throw new Error('No response from server.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let doneReading = false;
      let buffer = '';

      while (!doneReading) {
        const { value, done } = await reader.read();
        doneReading = done;
        if (value) {
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() || '';
          for (const part of parts) {
            if (part.startsWith('data: ')) {
              try {
                const data = JSON.parse(part.slice(6));
                if (data.type === 'log') setSshLogs((prev) => [...prev, data.message]);
                else if (data.type === 'password_change_required') {
                  pendingDeployRef.current = {
                    host: deployHost,
                    username: deployUser,
                    auth: deployAuth,
                    envVars: deployEnv,
                  };
                  setIsDeploying(false);
                  setNewSshPassword('');
                  setConfirmNewSshPassword('');
                  setPasswordChangeOpen(true);
                  return;
                } else if (data.type === 'password_changed') {
                  navigator.clipboard.writeText(data.newPassword);
                  toast.warning('Server password updated.', {
                    duration: 60000,
                    position: 'bottom-left',
                  });
                } else if (data.type === 'done') {
                  if (data.success) {
                    localStorage.setItem(deployedUrlKey(sid), data.url!);
                    localStorage.setItem(deployedProviderKey(sid), 'hetzner');
                    saveDeployment(sid, {
                      provider: 'hetzner',
                      project: deployHost,
                      url: data.url!,
                      status: 'ready',
                    });
                    toast.success('Server deployed via SSH successfully!', {
                      position: 'bottom-left',
                    });
                    pendingDeployRef.current = null;
                    onOpenChange(false);
                  } else
                    toast.error(data.error || 'Failed to deploy via SSH.', {
                      position: 'bottom-left',
                    });
                } else if (data.type === 'error')
                  toast.error(data.error || 'Failed to deploy.', { position: 'bottom-left' });
              } catch (e) {}
            }
          }
        }
      }
    } catch (e: any) {
      toast.error(e.message || 'An unexpected error occurred.', { position: 'bottom-left' });
    } finally {
      setIsDeploying(false);
    }
  }

  const handlePasswordChangeAndRedeploy = async () => {
    if (!newSshPassword) {
      toast.error('Enter a new password.', { position: 'bottom-left' });
      return;
    }
    if (newSshPassword !== confirmNewSshPassword) {
      toast.error('Passwords do not match.', { position: 'bottom-left' });
      return;
    }
    if (newSshPassword.length < 8) {
      toast.error('Password must be at least 8 characters.', { position: 'bottom-left' });
      return;
    }
    setPasswordChangeOpen(false);
    setSshLogs((prev) => [...prev, '', '--- Retrying with new password ---']);
    await actuallyDeployToSSH(activeServerId, newSshPassword);
  };

  const isGeneralActive = activeTab === 'general';

  return (
    <>
      <Sheet
        open={open && !passwordChangeOpen}
        onOpenChange={(v) => {
          if (!isDeploying) onOpenChange(v);
        }}
      >
        <SheetContent className="flex flex-col h-full max-w-[90%]! w-187.5! overflow-y-auto p-0 border-l">
          <div className="p-6 pb-0 space-y-1">
            <SheetHeader className="text-left">
              <SheetTitle>
                {target === 'env'
                  ? 'Environment Settings'
                  : `Deploy to ${target === 'vercel' ? 'Vercel' : 'Server'}`}
              </SheetTitle>
              <SheetDescription>
                {target === 'env'
                  ? 'Configure environment variables and storage.'
                  : 'Configure your deployment settings before launching.'}
              </SheetDescription>
            </SheetHeader>
          </div>

          <div className="flex-1 px-6  overflow-y-auto">
            {target !== 'env' && (
              <Tabs
                value={activeTab}
                onValueChange={(value) => setActiveTab(value as typeof activeTab)}
              >
                <TabsList className=" rounded-md border bg-muted/20  w-fit ">
                  <TabsTrigger
                    value="general"
                    className={`h-8 rounded-md px-4 text-xs font-medium transition-all data-[state=active]:bg-background data-[state=active]: ${
                      tabError === 'general' ? 'text-destructive border-destructive/60' : ''
                    }`}
                  >
                    <Settings2 className="size-3.5 mr-1.5" />
                    General
                  </TabsTrigger>
                  <TabsTrigger
                    value="provider"
                    className={`h-8 rounded-md px-4 text-xs font-medium transition-all data-[state=active]:bg-background data-[state=active]: ${
                      tabError === 'provider' ? 'text-destructive border-destructive/60' : ''
                    }`}
                  >
                    <Cloud className="size-3.5 mr-1.5" />
                    Provider
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            )}

            <div className={`mt-5 space-y-8 ${!isGeneralActive ? 'hidden' : 'block'}`}>
              {/* Storage Config */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold tracking-tight">Vector Storage</h3>
                  <label className="flex items-center gap-2 text-xs font-medium cursor-pointer bg-muted/20 px-2.5 py-1 rounded-md border">
                    <input
                      type="checkbox"
                      className="shrink-0"
                      checked={copyKnowledgeBase}
                      onChange={(e) => setCopyKnowledgeBase(e.target.checked)}
                    />
                    Include Knowledge Base
                  </label>
                </div>
                <div className="space-y-3 p-4 rounded-xl border bg-muted/10">
                  <div className="flex items-center justify-between">
                    <Select
                      value={storeId}
                      onValueChange={(value) => changeStore(value as VectorStoreId)}
                    >
                      <SelectTrigger className="w-50 bg-background">
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
                            <SelectItem
                              key={candidate.id}
                              value={candidate.id}
                              disabled={isComingSoon}
                            >
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
                      variant={credentialsVerified ? 'secondary' : 'outline'}
                      size="sm"
                      onClick={verifyCredentials}
                      disabled={testing || requiresCloudStorage}
                    >
                      {testing ? (
                        <Loader2 className="size-3.5 mr-2 animate-spin" />
                      ) : credentialsVerified ? (
                        <BadgeCheck className="size-3.5 mr-2 text-emerald-500" />
                      ) : (
                        <PlugZap className="size-3.5 mr-2" />
                      )}
                      {credentialsVerified ? 'Verified' : 'Verify'}
                    </Button>
                  </div>
                  {requiresCloudStorage && (
                    <p className="text-xs text-destructive">
                      You must select a cloud storage provider before deploying.
                    </p>
                  )}
                  <StoreFields
                    store={store}
                    values={storeConfig}
                    errors={errors}
                    indexType={source?.config.indexType}
                    onChange={(key, value) => {
                      setStoreConfig((cur) => ({ ...cur, [key]: value }));
                      setErrors((cur) => ({ ...cur, [key]: '' }));
                      setCredentialsVerified(false);
                    }}
                  />
                  <div className="pt-2 border-t mt-4">
                    <h3 className="text-sm font-semibold mb-3">Embedding Model</h3>
                    <Select
                      value={embeddingModelId}
                      onValueChange={(value) => {
                        setEmbeddingModelId(value || '');
                        setCredentialsVerified(false);
                      }}
                    >
                      <SelectTrigger className="w-full bg-white">
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

              {/* Environment Variables */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold tracking-tight">Environment Variables</h3>
                <div className="grid gap-4 p-4 rounded-xl border bg-muted/10">
                  <div className="grid gap-2">
                    <Label>
                      SERVER_API_KEY{' '}
                      <span className="text-xs font-normal text-muted-foreground">(Optional)</span>
                    </Label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Input
                          type={showApiKey ? 'text' : 'password'}
                          value={apiKey}
                          onChange={(e) => setApiKey(e.target.value)}
                        />
                        <button
                          type="button"
                          onClick={() => setShowApiKey(!showApiKey)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                        >
                          <Eye className="size-4" />
                        </button>
                      </div>
                      <Button variant="outline" size="icon" onClick={handleGenerateKey}>
                        <Dices className="size-4" />
                      </Button>
                    </div>
                  </div>
                  {requiredEnv.map((env) => (
                    <div key={env.key} className="grid gap-2">
                      <Label>
                        {env.key}
                        {env.required && <span className="text-destructive ml-1">*</span>}{' '}
                        {envValues[env.key] && (
                          <span className="text-emerald-500 text-[10px] ml-2">Pre-filled</span>
                        )}
                      </Label>
                      <div className="relative flex-1">
                        <Input
                          type={showEnvVars[env.key] ? 'text' : 'password'}
                          value={envValues[env.key] || ''}
                          onChange={(e) =>
                            setEnvValues({ ...envValues, [env.key]: e.target.value })
                          }
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setShowEnvVars((prev) => ({ ...prev, [env.key]: !prev[env.key] }))
                          }
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                        >
                          <Eye className="size-4" />
                        </button>
                      </div>
                      {env.help && <p className="text-xs text-muted-foreground">{env.help}</p>}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className={`mt-5 space-y-8 ${isGeneralActive ? 'hidden' : 'block'}`}>
              {target === 'vercel' ? (
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
                        onChange={(e) => setVercelToken(e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => setShowToken(!showToken)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                      >
                        <Eye className="size-4" />
                      </button>
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label>
                      Project Name <span className="text-destructive ml-1">*</span>
                    </Label>
                    <Input
                      value={vercelProject}
                      onChange={(e) => setVercelProject(e.target.value)}
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid gap-2">
                    <Label>
                      Server IP / Hostname <span className="text-destructive ml-1">*</span>
                    </Label>
                    <Input value={sshHost} onChange={(e) => setSshHost(e.target.value)} />
                  </div>
                  <div className="grid gap-2">
                    <Label>
                      SSH Username <span className="text-destructive ml-1">*</span>
                    </Label>
                    <Input value={sshUsername} onChange={(e) => setSshUsername(e.target.value)} />
                  </div>
                  <div className="grid gap-2">
                    <div className="flex gap-2 mb-2">
                      <Badge
                        variant={sshAuthType === 'key' ? 'default' : 'outline'}
                        className="cursor-pointer"
                        onClick={() => setSshAuthType('key')}
                      >
                        Private Key
                      </Badge>
                      <Badge
                        variant={sshAuthType === 'password' ? 'default' : 'outline'}
                        className="cursor-pointer"
                        onClick={() => setSshAuthType('password')}
                      >
                        Password
                      </Badge>
                    </div>
                    {sshAuthType === 'key' ? (
                      <textarea
                        className="min-h-30 rounded-md border bg-transparent px-3 py-2 text-sm font-mono"
                        value={sshKeyOrPassword}
                        onChange={(e) => setSshKeyOrPassword(e.target.value)}
                      />
                    ) : (
                      <div className="relative flex-1">
                        <Input
                          type={showSshPassword ? 'text' : 'password'}
                          value={sshKeyOrPassword}
                          onChange={(e) => setSshKeyOrPassword(e.target.value)}
                        />
                        <button
                          type="button"
                          onClick={() => setShowSshPassword(!showSshPassword)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                        >
                          <Eye className="size-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {isDeploying && sshLogs.length > 0 && (
                <div className="bg-black text-[#00ff00] font-mono text-[10px] p-3 rounded-md h-50 overflow-y-auto break-all whitespace-pre-wrap flex flex-col-reverse">
                  <div>
                    {sshLogs.map((log, i) => (
                      <div key={i}>{log}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {autoDeployPending && (
              <div className="mt-8 space-y-3 rounded-lg border p-5 bg-muted/10">
                <div className="flex justify-between text-sm font-medium">
                  <span>
                    {run?.status === 'completed'
                      ? 'Knowledge base uploaded'
                      : 'Uploading knowledge base'}
                  </span>
                  <span className="tabular-nums">{progress}%</span>
                </div>
                <Progress value={progress} className="h-2" />
                <p className="text-xs text-muted-foreground pt-1">
                  {run?.warning || `${run?.processedChunks ?? 0} / ${run?.totalChunks ?? 0} chunks`}
                </p>
              </div>
            )}
          </div>

          <div className="sticky bottom-0 z-10 border-t bg-background px-6 py-4 flex items-center justify-between mt-auto">
            <Button
              variant="outline"
              className="px-5"
              onClick={() => onOpenChange(false)}
              disabled={isDeploying || autoDeployPending}
            >
              Cancel
            </Button>
            <Button
              className="px-7"
              onClick={handleDeploy}
              disabled={isDeploying || autoDeployPending}
            >
              {(isDeploying || autoDeployPending) && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              {target === 'env' ? 'Save Settings' : 'Deploy'}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet
        open={passwordChangeOpen}
        onOpenChange={(open) => {
          if (!open) pendingDeployRef.current = null;
          setPasswordChangeOpen(open);
        }}
      >
        <SheetContent className="flex flex-col h-full sm:max-w-md w-full overflow-y-auto p-0 border-l">
          <div className="p-6 pb-0 space-y-1">
            <SheetHeader className="text-left">
              <SheetTitle>Password Change Required</SheetTitle>
              <SheetDescription>
                Your server requires a password change on first login.
              </SheetDescription>
            </SheetHeader>
          </div>
          <div className="flex-1 p-6 overflow-y-auto grid gap-4">
            <div className="grid gap-2">
              <Label>New Password</Label>
              <Input
                type="password"
                value={newSshPassword}
                onChange={(e) => setNewSshPassword(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label>Confirm Password</Label>
              <Input
                type="password"
                value={confirmNewSshPassword}
                onChange={(e) => setConfirmNewSshPassword(e.target.value)}
              />
            </div>
          </div>
          <div className="sticky bottom-0 border-t bg-background px-6 py-4 flex justify-between">
            <Button variant="outline" onClick={() => setPasswordChangeOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handlePasswordChangeAndRedeploy}>Change & Deploy</Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
