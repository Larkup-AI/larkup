'use server';

import fs from 'fs';
import path from 'path';
import { getActiveServer } from '@larkup/core/workspace';

const VERCEL_API = 'https://api.vercel.com';

interface VercelProject {
  id: string;
  name: string;
  /** Domains currently assigned to the project, including production aliases. */
  alias?: Array<
    | string
    | {
        domain?: string;
        alias?: string;
        target?: string;
        environment?: string;
        redirect?: string | null;
      }
  >;
  targets?: {
    production?: {
      alias?: string[];
    };
  };
  link?: {
    type: string;
    repo?: string;
    repoId?: number;
    org?: string;
    gitCredentialId?: string;
    productionBranch?: string;
  };
}

interface VercelProjectDomain {
  name: string;
  redirect?: string | null;
  /** Domains assigned to preview branches must not be used as the API endpoint. */
  gitBranch?: string | null;
}

interface VercelProjectAlias {
  domain?: string;
  alias?: string;
  target?: string;
  environment?: string;
  redirect?: string | null;
}

interface VercelDeployment {
  id: string;
  uid: string;
  name: string;
  url: string;
  readyState: string;
  target?: string;
  /** Production aliases assigned by Vercel once the deployment is ready. */
  alias?: string[];
  /** Kept for compatibility with older Vercel API responses. */
  aliases?: string[];
}

type DeploymentStatus = 'queued' | 'building' | 'ready' | 'error' | 'unknown';

function normalizeDeploymentStatus(status?: string): DeploymentStatus {
  switch (status?.toUpperCase()) {
    case 'QUEUED':
    case 'INITIALIZING':
      return 'queued';
    case 'BUILDING':
      return 'building';
    case 'READY':
      return 'ready';
    case 'ERROR':
    case 'CANCELED':
      return 'error';
    default:
      return 'unknown';
  }
}

async function vercelFetch(path: string, token: string, options: RequestInit = {}) {
  const res = await fetch(`${VERCEL_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = { rawText: text };
  }

  if (!res.ok) {
    const msg =
      body?.error?.message ||
      body?.message ||
      `API error occurred: Status ${res.status} Content-Type "${res.headers.get(
        'content-type',
      )}". Body: ${text}`;
    throw new Error(msg);
  }

  return body;
}

/** Look up a project by name or ID. Returns null if not found. */
async function getProject(token: string, nameOrId: string): Promise<VercelProject | null> {
  try {
    const data = await vercelFetch(`/v9/projects/${encodeURIComponent(nameOrId)}`, token);
    return data as VercelProject;
  } catch (e: any) {
    if (
      e.message?.toLowerCase().includes('not found') ||
      e.message?.toLowerCase().includes('project not found')
    ) {
      return null;
    }
    throw e;
  }
}

/** Create a new blank Vercel project. */
async function createProject(token: string, name: string): Promise<VercelProject> {
  const data = await vercelFetch(`/v9/projects`, token, {
    method: 'POST',
    body: JSON.stringify({ name, framework: null }),
  });
  return data as VercelProject;
}

/** Set an environment variable for the project */
async function setProjectEnv(token: string, projectId: string, key: string, value: string) {
  const envData = await vercelFetch(`/v9/projects/${projectId}/env`, token);
  const existing = envData.envs?.find((e: any) => e.key === key);

  if (existing) {
    await vercelFetch(`/v9/projects/${projectId}/env/${existing.id}`, token, {
      method: 'PATCH',
      body: JSON.stringify({
        value,
        target: ['production', 'preview', 'development'],
      }),
    });
  } else {
    await vercelFetch(`/v10/projects/${projectId}/env`, token, {
      method: 'POST',
      body: JSON.stringify([
        {
          key,
          value,
          target: ['production', 'preview', 'development'],
          type: 'plain',
        },
      ]),
    });
  }
}

/** Deploy by sending files directly. */
async function triggerDeploymentWithFiles(
  token: string,
  project: VercelProject,
  files: any[],
): Promise<VercelDeployment> {
  const body: Record<string, any> = {
    name: project.name,
    target: 'production',
    files,
  };

  const data = await vercelFetch(`/v13/deployments`, token, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  return data as VercelDeployment;
}

function asHttpsUrl(hostname?: string) {
  if (!hostname) return undefined;
  return hostname.startsWith('http') ? hostname.replace(/\/$/, '') : `https://${hostname}`;
}

function hostnameFromAlias(alias: string | VercelProjectAlias) {
  return typeof alias === 'string' ? alias : alias.domain ?? alias.alias;
}

function pickProductionHostname(hostnames: string[]) {
  // The project-level `*.vercel.app` hostname is stable. Deployment hostnames
  // contain a generated hash and can be covered by Deployment Protection.
  return hostnames.find((hostname) => hostname.endsWith('.vercel.app')) ?? hostnames[0];
}

/** Return a production project hostname that is never a deployment URL. */
async function getProjectProductionUrl(token: string, project: VercelProject) {
  // Project domains are the authoritative source for the stable default
  // hostname (for example, demo4-taupe.vercel.app). Check these first so a
  // generated deployment alias can never win over the public project domain.
  try {
    const data = await vercelFetch(`/v9/projects/${encodeURIComponent(project.id)}/domains`, token);
    const domains = (data.domains ?? []) as VercelProjectDomain[];
    const productionDomains = domains
      .filter((domain) => !domain.redirect && !domain.gitBranch)
      .map((domain) => domain.name);
    const productionHostname = pickProductionHostname(productionDomains);
    if (productionHostname) return asHttpsUrl(productionHostname);
  } catch {
    // Fall back to aliases returned with the project below.
  }

  const configuredAliases = [
    ...(project.alias ?? []),
    ...(project.targets?.production?.alias ?? []),
  ]
    .filter((alias) => typeof alias === 'string' || !alias.redirect)
    .map(hostnameFromAlias)
    .filter((hostname): hostname is string => Boolean(hostname));
  const configuredUrl = pickProductionHostname(configuredAliases);
  if (configuredUrl) return asHttpsUrl(configuredUrl);
  return undefined;
}

/**
 * Resolve the public URL Vercel assigned to a deployment.
 *
 * A project name is not a deployment URL: Vercel may add a suffix to the
 * alias (for example, `demo3-zeta-one.vercel.app`). The deployment response
 * can also contain the immutable, hash-suffixed deployment hostname, so use
 * Vercel's deployment-alias endpoint as the source of truth. Fall back to the
 * response and then the immutable URL while an alias is still being assigned.
 */
async function getDeploymentPublicUrl(
  token: string,
  deployment?: VercelDeployment,
  project?: VercelProject,
) {
  if (!deployment) return undefined;

  // The project response identifies the stable production domain (for example
  // `demo3-zeta-one.vercel.app`). Deployment URLs are intentionally unique
  // and contain a hash, so they must not be displayed as the cloud endpoint.
  const projectUrl = project ? await getProjectProductionUrl(token, project) : undefined;
  if (projectUrl) return projectUrl;

  // This endpoint lists the aliases currently assigned to this deployment,
  // including the stable production `*.vercel.app` alias. Do not use
  // `deployment.url` until this endpoint has no aliases: it is the generated,
  // immutable deployment URL rather than the production URL.
  try {
    const data = await vercelFetch(`/v2/deployments/${deployment.id}/aliases`, token);
    const aliases = Array.isArray(data.aliases) ? data.aliases : [];
    const hostnames: string[] = aliases
      .map((alias: string | { alias?: string; domain?: string }) =>
        typeof alias === 'string' ? alias : alias.alias ?? alias.domain,
      )
      .filter((alias: string | undefined): alias is string => Boolean(alias));
    const vercelAlias = hostnames.find((alias: string) => alias.endsWith('.vercel.app'));
    if (vercelAlias) return asHttpsUrl(vercelAlias);
    if (hostnames[0]) return asHttpsUrl(hostnames[0]);
  } catch {
    // Deployments do not have aliases while queued; use Vercel's returned URL
    // until a subsequent status refresh can replace it.
  }

  // Some create-deployment responses include aliases before the aliases
  // endpoint becomes consistent. Retain this as a fallback only.
  const responseAliases = deployment.alias ?? deployment.aliases ?? [];
  const responseAlias = responseAliases.find((alias: string) => alias.endsWith('.vercel.app'));
  if (responseAlias) return asHttpsUrl(responseAlias);
  if (responseAliases[0]) return asHttpsUrl(responseAliases[0]);

  return asHttpsUrl(deployment.url);
}

export async function getServerEnvRequirements(serverId: string) {
  let activeId = serverId;
  if (activeId === 'default') {
    const server = await getActiveServer();
    if (server) activeId = server.id;
  }

  const cwd = process.cwd();

  let vectorStore: string = 'lancedb';
  let storeConfig: Record<string, string> = {};
  let ragConfig: Record<string, any> = {};
  const configCandidates = [
    path.join(cwd, '.larkup', 'servers', activeId, 'config.json'),
    path.join(cwd, '.larkup', 'config.json'),
  ];
  for (const cfgPath of configCandidates) {
    if (fs.existsSync(cfgPath)) {
      try {
        const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
        ragConfig = cfg;
        vectorStore = cfg.vectorStore ?? 'lancedb';
        storeConfig = cfg.storeConfig ?? {};
        break;
      } catch {
        // continue to next candidate
      }
    }
  }

  // ── Map storeConfig fields → env var names.
  // automatically pre-filled as defaults in the env-vars sheet.
  const storeDefaults: Record<string, string> = {};
  if (vectorStore === 'pinecone') {
    if (storeConfig.apiKey) storeDefaults['PINECONE_API_KEY'] = storeConfig.apiKey;
    if (storeConfig.indexName) storeDefaults['PINECONE_INDEX'] = storeConfig.indexName;
    if (storeConfig.namespace) storeDefaults['PINECONE_NAMESPACE'] = storeConfig.namespace;
    if (storeConfig.sparseModel) storeDefaults['PINECONE_SPARSE_MODEL'] = storeConfig.sparseModel;
    if (storeConfig.sparseIndexName)
      storeDefaults['PINECONE_SPARSE_INDEX'] = storeConfig.sparseIndexName;
  } else {
    if (storeConfig.mode) storeDefaults['LANCEDB_MODE'] = storeConfig.mode;
    if (storeConfig.tableName) storeDefaults['LANCEDB_TABLE'] = storeConfig.tableName;
    if (storeConfig.uri) storeDefaults['LANCEDB_URI'] = storeConfig.uri;
    if (storeConfig.apiKey) storeDefaults['LANCEDB_API_KEY'] = storeConfig.apiKey;
    if (storeConfig.s3Uri) storeDefaults['LANCEDB_S3_URI'] = storeConfig.s3Uri;
    if (storeConfig.s3Endpoint) storeDefaults['AWS_ENDPOINT'] = storeConfig.s3Endpoint;
    if (storeConfig.s3Region) storeDefaults['AWS_REGION'] = storeConfig.s3Region;
    if (storeConfig.s3AccessKeyId) storeDefaults['AWS_ACCESS_KEY_ID'] = storeConfig.s3AccessKeyId;
    if (storeConfig.s3SecretAccessKey)
      storeDefaults['AWS_SECRET_ACCESS_KEY'] = storeConfig.s3SecretAccessKey;
  }

  // SERVER_API_KEY, PORT, and LANCEDB_PATH are handled internally.
  const envVarDefs: { key: string; required: boolean; help: string }[] = [
    {
      key: 'EMBEDDING_API_KEY',
      required: true,
      help: 'API key used to embed incoming queries.',
    },
  ];

  envVarDefs.push(
    {
      key: 'CHAT_API_KEY',
      required: false,
      help: 'OpenAI-compatible API key for streamed chat. Required when chat is enabled.',
    },
    {
      key: 'CHAT_MODEL',
      required: false,
      help: 'Chat model ID (defaults to gpt-4o-mini).',
    },
  );

  if (vectorStore === 'pinecone') {
    envVarDefs.push(
      { key: 'PINECONE_API_KEY', required: true, help: 'Pinecone API key.' },
      { key: 'PINECONE_INDEX', required: true, help: 'Pinecone index name to query.' },
      {
        key: 'PINECONE_NAMESPACE',
        required: false,
        help: "Pinecone namespace (default 'default').",
      },
      {
        key: 'PINECONE_SPARSE_MODEL',
        required: false,
        help: 'Pinecone sparse model (for hybrid search).',
      },
      {
        key: 'PINECONE_SPARSE_INDEX',
        required: false,
        help: 'Pinecone sparse index name (for hybrid search).',
      },
    );
  } else {
    // lancedb
    envVarDefs.push(
      {
        key: 'LANCEDB_MODE',
        required: false,
        help: "'local', 's3', or 'cloud'. Set automatically from Storage settings.",
      },
      {
        key: 'LANCEDB_TABLE',
        required: false,
        help: "Table name holding the embedded chunks (default 'documents').",
      },
      { key: 'LANCEDB_S3_URI', required: false, help: 'S3-compatible database URI.' },
      {
        key: 'AWS_ENDPOINT',
        required: false,
        help: 'S3-compatible endpoint (e.g. Cloudflare R2).',
      },
      { key: 'AWS_REGION', required: false, help: 'S3 region (use auto for Cloudflare R2).' },
      { key: 'AWS_ACCESS_KEY_ID', required: false, help: 'S3-compatible access key ID.' },
      { key: 'AWS_SECRET_ACCESS_KEY', required: false, help: 'S3-compatible secret access key.' },
      { key: 'LANCEDB_URI', required: false, help: 'LanceDB Cloud database URI (cloud mode).' },
      { key: 'LANCEDB_API_KEY', required: false, help: 'LanceDB Cloud API key (cloud mode).' },
    );
  }

  // ── Load .env file defaults (lowest priority).
  const rootEnvPath = path.join(cwd, '.env');
  const monoRootEnvPath = path.join(cwd, '../..', '.env');
  const envFileDefaults: Record<string, string> = {};
  for (const envFile of [monoRootEnvPath, rootEnvPath]) {
    if (fs.existsSync(envFile)) {
      const content = fs.readFileSync(envFile, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
          const [key, ...rest] = trimmed.split('=');
          let val = rest.join('=').trim();
          if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
          else if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
          envFileDefaults[key.trim()] = val;
        }
      }
    }
  }

  return envVarDefs.map((e) => {
    let defaultValue = storeDefaults[e.key] || envFileDefaults[e.key] || '';
    if (e.key === 'EMBEDDING_API_KEY' && !defaultValue) {
      // try to read from config directly
      const cwd = process.cwd();
      const configCandidates = [
        path.join(cwd, '.larkup', 'servers', activeId, 'config.json'),
        path.join(cwd, '.larkup', 'config.json'),
      ];
      for (const cfgPath of configCandidates) {
        if (fs.existsSync(cfgPath)) {
          try {
            const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
            if (cfg.embeddingApiKey) defaultValue = cfg.embeddingApiKey;
            break;
          } catch {}
        }
      }
    }
    if (e.key === 'CHAT_API_KEY' && !defaultValue) {
      defaultValue = ragConfig.deployment?.chatApiKey || ragConfig.chatApiKey || '';
    }
    if (e.key === 'CHAT_MODEL' && !defaultValue) {
      defaultValue = ragConfig.deployment?.chatModelId || ragConfig.chatModelId || '';
    }
    return {
      key: e.key,
      help: e.help,
      required: e.required,
      defaultValue,
    };
  });
}

export async function deployToVercel(
  token: string,
  projectIdOrName: string,
  serverId: string,
  envVars: Record<string, string> = {},
) {
  let activeId = serverId;
  if (activeId === 'default') {
    const server = await getActiveServer();
    if (server) activeId = server.id;
  }

  if (!token || !projectIdOrName) {
    return {
      success: false,
      error: 'Vercel token and project ID/name are required.',
    };
  }

  if (!activeId) {
    return {
      success: false,
      error: 'Server ID is required to read deployment files.',
    };
  }

  try {
    let project = await getProject(token, projectIdOrName);
    const wasNew = !project;

    if (!project) {
      console.log(`Project "${projectIdOrName}" not found. Creating it...`);
      project = await createProject(token, projectIdOrName);
      console.log(`Created project: ${project.id} (${project.name})`);
    }

    for (const [key, value] of Object.entries(envVars)) {
      if (value) {
        await setProjectEnv(token, project.id, key, value);
      }
    }

    let config: any = null;
    const cwd = process.cwd();
    const configCandidates = [
      path.join(cwd, '.larkup', 'servers', activeId, 'config.json'),
      path.join(cwd, '.larkup', 'config.json'),
    ];
    for (const cfgPath of configCandidates) {
      if (fs.existsSync(cfgPath)) {
        try {
          config = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
          break;
        } catch {}
      }
    }

    if (!config) {
      return { success: false, error: 'Configuration not found. Please save your settings first.' };
    }

    const isLanceLocal =
      config.vectorStore === 'lancedb' && (config.storeConfig?.mode ?? 'local') === 'local';
    if (isLanceLocal) {
      return {
        success: false,
        code: 'cloud_vector_store_required',
        error: 'A cloud vector store is required for this deployment.',
      };
    }

    const { generateServer } = await import('@larkup/core/generator/generate-server');
    const generated = generateServer(config);

    const files = generated.files.map((f) => ({
      file: f.path,
      data: f.encoding === 'base64' ? f.contents : Buffer.from(f.contents).toString('base64'),
      encoding: 'base64',
    }));

    if (files.length === 0) {
      return {
        success: false,
        error: 'No files found to deploy in the server directory.',
      };
    }

    const deployRes = await triggerDeploymentWithFiles(token, project, files);

    const url = await getDeploymentPublicUrl(token, deployRes, project);

    return {
      success: true,
      url: url ?? `https://${deployRes.url}`,
      projectName: project.name,
      deploymentId: deployRes?.id,
      status: normalizeDeploymentStatus(deployRes?.readyState),
      projectCreated: wasNew,
    };
  } catch (error: any) {
    console.error('Vercel Deploy Error:', error);
    return {
      success: false,
      error: error.message || 'Failed to trigger deployment on Vercel.',
    };
  }
}

/** Poll the latest production deployment so the UI can reconcile optimistic state. */
export async function getVercelDeploymentStatus(token: string, projectIdOrName: string) {
  if (!token || !projectIdOrName) return { status: 'unknown' as const, hasProductionAlias: false };

  try {
    const project = await getProject(token, projectIdOrName);
    if (!project) return { status: 'unknown' as const, hasProductionAlias: false };
    const data = await vercelFetch(
      `/v6/deployments?projectId=${encodeURIComponent(project.id)}&target=production&limit=1`,
      token,
    );
    const deployment = data.deployments?.[0] as VercelDeployment | undefined;
    const productionUrl = await getProjectProductionUrl(token, project);
    return {
      status: normalizeDeploymentStatus(deployment?.readyState),
      url: productionUrl ?? (await getDeploymentPublicUrl(token, deployment, project)),
      hasProductionAlias: Boolean(productionUrl),
    };
  } catch {
    return { status: 'unknown' as const, hasProductionAlias: false };
  }
}
