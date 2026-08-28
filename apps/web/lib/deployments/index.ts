import type { DeploymentStatus } from '@larkup/core/deployments-store';
import type { RagConfig, VectorStoreId } from '@larkup/core/types';

const deploymentApiKeyPrefix = 'larkup-deployment-api-key:';

export type DeploymentTargetId = 'Vercel' | 'Hetzner' | 'AWS' | 'Azure' | 'GCP' | 'DigitalOcean';

export type DeploymentTarget = {
  id: DeploymentTargetId;
  label: string;
  icon: string;
  kind: 'serverless' | 'vps';
};

export type DeploymentStorageSettings = {
  vectorStore?: VectorStoreId;
  storeConfig?: Record<string, string>;
  embeddingModelId?: string;
  chatProvider?: string;
  chatModelId?: string;
  chatApiKey?: string;
};

export const DEPLOYMENT_TARGETS: Record<DeploymentTargetId, DeploymentTarget> = {
  Vercel: { id: 'Vercel', label: 'Vercel', icon: '/icons/vercel.svg', kind: 'serverless' },
  Hetzner: { id: 'Hetzner', label: 'Hetzner', icon: '/hetzner.svg', kind: 'vps' },
  AWS: { id: 'AWS', label: 'AWS', icon: '/icons/aws.svg', kind: 'vps' },
  Azure: { id: 'Azure', label: 'Azure', icon: '/icons/azure.svg', kind: 'vps' },
  GCP: { id: 'GCP', label: 'GCP', icon: '/icons/gcp.svg', kind: 'vps' },
  DigitalOcean: {
    id: 'DigitalOcean',
    label: 'DigitalOcean',
    icon: '/icons/digital-ocean.webp',
    kind: 'vps',
  },
};

export const VERCEL_DEPLOYMENT_API_URL =
  'https://api.vercel.com/v13/deployments?skipAutoDetectionConfirmation=1';

export function deploymentApiKeyStorageKey(deploymentId: string) {
  return `${deploymentApiKeyPrefix}${deploymentId}`;
}

export function readDeploymentApiKey(deploymentId: string) {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(deploymentApiKeyStorageKey(deploymentId));
}

export function saveDeploymentApiKey(deploymentId: string, apiKey: string) {
  if (typeof window === 'undefined' || !apiKey) return;
  window.localStorage.setItem(deploymentApiKeyStorageKey(deploymentId), apiKey);
}

export function removeDeploymentApiKey(deploymentId: string) {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(deploymentApiKeyStorageKey(deploymentId));
}

export function applyDeploymentStorageSettings(
  config: RagConfig,
  storage?: DeploymentStorageSettings,
): RagConfig {
  return {
    ...config,
    vectorStore: storage?.vectorStore ?? config.vectorStore,
    storeConfig: storage?.storeConfig ?? config.storeConfig,
    embeddingModelId: storage?.embeddingModelId ?? config.embeddingModelId,
    chatProvider: storage?.chatProvider ?? config.chatProvider,
    chatModelId: storage?.chatModelId ?? config.chatModelId,
    chatApiKey: storage?.chatApiKey ?? config.chatApiKey,
  };
}

export function getDeploymentTarget(value: string | null | undefined): DeploymentTarget | null {
  if (!value) return null;
  const normalized = value === 'Docker' ? 'Hetzner' : value;
  return DEPLOYMENT_TARGETS[normalized as DeploymentTargetId] ?? null;
}

export function deploymentEndpointForHost(host: string) {
  const value = host
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');
  return value ? `http://${value}:8080` : '';
}

export function vercelDeploymentStatusUrl(idOrHostname: string) {
  return `https://api.vercel.com/v13/deployments/${encodeURIComponent(idOrHostname)}`;
}

export function deploymentStatusFromVercelReadyState(readyState: unknown): DeploymentStatus {
  switch (typeof readyState === 'string' ? readyState.toUpperCase() : '') {
    case 'QUEUED':
      return 'queued';
    case 'INITIALIZING':
    case 'BUILDING':
      return 'building';
    case 'READY':
      return 'ready';
    case 'ERROR':
      return 'error';
    case 'CANCELED':
      return 'canceled';
    default:
      return 'unknown';
  }
}
