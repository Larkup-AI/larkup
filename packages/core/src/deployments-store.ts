import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getProjectDataDir, requireProjectDataDir } from './project-store';

export type DeploymentProfile = 'knowledge' | 'assistant';
export type DeploymentStatus =
  | 'unknown'
  | 'queued'
  | 'building'
  | 'ready'
  | 'error'
  | 'canceled'
  | 'unavailable';

export interface ProjectDeployment {
  id: string;
  name: string;
  provider: string;
  profile: DeploymentProfile;
  endpoint: string;
  /** Provider-specific deployment identifier, used for lifecycle status checks. */
  remoteId?: string;
  /** A visible deployment-time snapshot of the Assistant profile configuration. */
  assistantOptions?: {
    systemPrompt?: string;
    enabledTools?: string[];
    enabledMcp?: string[];
    enabledSkills?: string[];
    enabledPlugins?: string[];
    sandboxProvider?: string;
  };
  status: DeploymentStatus;
  statusMessage?: string;
  lastCheckedAt?: string;
  createdAt: string;
  updatedAt: string;
}

async function deploymentsPath(create: boolean) {
  const directory = create ? await requireProjectDataDir() : await getProjectDataDir();
  return directory ? path.join(directory, 'deployments.json') : null;
}

export async function readDeployments(): Promise<ProjectDeployment[]> {
  const file = await deploymentsPath(false);
  if (!file) return [];
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as ProjectDeployment[];
  } catch {
    return [];
  }
}

async function writeDeployments(records: ProjectDeployment[]) {
  const file = await deploymentsPath(true);
  if (!file) throw new Error('An active Project is required.');
  await fs.writeFile(file, JSON.stringify(records, null, 2), 'utf8');
  return records;
}

export async function saveDeployment(
  input: Omit<ProjectDeployment, 'id' | 'status' | 'lastCheckedAt' | 'createdAt' | 'updatedAt'>,
) {
  const records = await readDeployments();
  const now = new Date().toISOString();
  const record: ProjectDeployment = {
    ...input,
    id: randomUUID(),
    status: input.provider === 'Vercel' ? 'queued' : 'unknown',
    createdAt: now,
    updatedAt: now,
  };
  await writeDeployments([record, ...records]);
  return record;
}

/** Update operator-managed metadata without touching any provider credentials. */
export async function updateDeploymentEndpoint(id: string, endpoint: string) {
  const records = await readDeployments();
  const current = records.find((record) => record.id === id);
  if (!current) return null;
  const next = {
    ...current,
    endpoint,
    status: 'unknown' as const,
    statusMessage: undefined,
    updatedAt: new Date().toISOString(),
  };
  await writeDeployments(records.map((record) => (record.id === id ? next : record)));
  return next;
}

/** Remove the locally saved deployment record without modifying the remote provider resource. */
export async function deleteDeployment(id: string): Promise<boolean> {
  const records = await readDeployments();
  if (!records.some((record) => record.id === id)) return false;
  await writeDeployments(records.filter((record) => record.id !== id));
  return true;
}

export async function updateDeploymentStatus(
  id: string,
  status: DeploymentStatus,
  statusMessage?: string,
): Promise<ProjectDeployment | null> {
  const records = await readDeployments();
  const current = records.find((record) => record.id === id);
  if (!current) return null;
  const next = {
    ...current,
    status,
    statusMessage,
    lastCheckedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await writeDeployments(records.map((record) => (record.id === id ? next : record)));
  return next;
}

export async function checkDeployment(id: string): Promise<ProjectDeployment | null> {
  const records = await readDeployments();
  const current = records.find((record) => record.id === id);
  if (!current) return null;
  let status: DeploymentStatus = 'unavailable';
  let statusMessage: string | undefined;
  try {
    const response = await fetch(`${current.endpoint.replace(/\/$/, '')}/health`, {
      signal: AbortSignal.timeout(8_000),
    });
    const payload = (await response.json().catch(() => null)) as { ok?: unknown; profile?: unknown } | null;
    status = response.ok && payload?.ok === true && typeof payload.profile === 'string' ? 'ready' : 'unavailable';
    if (status === 'unavailable') {
      statusMessage = response.ok
        ? 'The endpoint did not return a Larkup health response.'
        : `Health check returned HTTP ${response.status}.`;
    }
  } catch {
    status = 'unavailable';
    statusMessage = 'The endpoint could not be reached.';
  }
  const next = {
    ...current,
    status,
    statusMessage,
    lastCheckedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await writeDeployments(records.map((record) => (record.id === id ? next : record)));
  return next;
}
