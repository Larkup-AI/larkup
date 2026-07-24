export type DeploymentRecord = {
  id: string;
  provider: 'vercel' | 'hetzner' | 'azure' | 'aws' | 'gcp';
  project: string;
  url: string;
  status?: 'queued' | 'building' | 'ready' | 'error' | 'unknown';
  apiKeyVersion?: number;
  createdAt: string;
  updatedAt: string;
};

function storageKey(serverId: string) {
  return `larkup_deployments_${serverId}`;
}

export function deploymentEndpoint(deployment: DeploymentRecord) {
  return deployment.url.replace(/\/$/, '');
}

function apiKeyVersionKey(serverId: string) {
  return `larkup_api_key_version_${serverId}`;
}

export function getApiKeyVersion(serverId: string) {
  return Number.parseInt(localStorage.getItem(apiKeyVersionKey(serverId)) || '0', 10) || 0;
}

export function incrementApiKeyVersion(serverId: string) {
  const version = getApiKeyVersion(serverId) + 1;
  localStorage.setItem(apiKeyVersionKey(serverId), String(version));
  return version;
}

function legacyDeployment(serverId: string): DeploymentRecord[] {
  const url = localStorage.getItem(`vercel_deployed_url_${serverId}`);
  if (!url) return [];
  const provider = (localStorage.getItem(`vercel_deployed_provider_${serverId}`) ||
    'vercel') as DeploymentRecord['provider'];
  return [
    {
      id: `${provider}:${url}`,
      provider,
      project: localStorage.getItem(`vercel_project_${serverId}`) || url,
      url,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];
}

export function getDeployments(serverId: string): DeploymentRecord[] {
  try {
    const saved = localStorage.getItem(storageKey(serverId));
    if (saved) {
      return JSON.parse(saved) as DeploymentRecord[];
    }
  } catch {
    // Fall through to the legacy single-deployment storage.
  }
  const deployments = legacyDeployment(serverId);
  if (deployments.length) {
    localStorage.setItem(storageKey(serverId), JSON.stringify(deployments));
  }
  return deployments;
}

function writeDeployments(serverId: string, deployments: DeploymentRecord[]) {
  localStorage.setItem(storageKey(serverId), JSON.stringify(deployments));
  window.dispatchEvent(new CustomEvent('larkup-deployments-change', { detail: serverId }));
}

export function saveDeployment(
  serverId: string,
  deployment: Omit<DeploymentRecord, 'id' | 'createdAt' | 'updatedAt'>,
) {
  const deployments = getDeployments(serverId);
  const existingIndex = deployments.findIndex(
    (item) => item.provider === deployment.provider && item.project === deployment.project,
  );
  const now = new Date().toISOString();
  const record: DeploymentRecord = {
    ...deployment,
    apiKeyVersion: deployment.apiKeyVersion ?? getApiKeyVersion(serverId),
    id:
      existingIndex >= 0
        ? deployments[existingIndex].id
        : `${deployment.provider}:${deployment.project}`,
    createdAt: existingIndex >= 0 ? deployments[existingIndex].createdAt : now,
    updatedAt: now,
  };
  if (existingIndex >= 0) deployments[existingIndex] = record;
  else deployments.unshift(record);
  writeDeployments(serverId, deployments);
  return deployments;
}

export function updateDeploymentUrl(serverId: string, id: string, url: string) {
  return updateDeployment(serverId, id, { url });
}

export function updateDeployment(
  serverId: string,
  id: string,
  patch: Pick<Partial<DeploymentRecord>, 'url' | 'status'>,
) {
  const deployments = getDeployments(serverId).map((deployment) =>
    deployment.id === id
      ? { ...deployment, ...patch, updatedAt: new Date().toISOString() }
      : deployment,
  );
  writeDeployments(serverId, deployments);
  return deployments;
}

export function removeDeployment(serverId: string, id: string) {
  const deployments = getDeployments(serverId).filter((deployment) => deployment.id !== id);
  writeDeployments(serverId, deployments);
  return deployments;
}
