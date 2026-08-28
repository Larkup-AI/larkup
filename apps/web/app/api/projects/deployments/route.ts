import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { NodeSSH } from 'node-ssh';
import { readConfig, writeConfig } from '@larkup/core/config-store';
import {
  checkDeployment,
  deleteDeployment,
  readDeployments,
  saveDeployment,
  updateDeploymentEndpoint,
  updateDeploymentStatus,
} from '@larkup/core/deployments-store';
import { prepareAgentRuntime } from '@larkup/core/generator/server-runtime';
import { generateServer, type GeneratedFile } from '@larkup/core/generator/generate-server';
import type { RagConfig } from '@larkup/core/types';
import { getAllTools } from '@larkup/marketplace/registry';
import { getSandboxProvider } from '@larkup/sandbox/registry';
import { deploymentEndpointForHost, getDeploymentTarget } from '@/lib/deployments';
import {
  deploymentStatusFromVercelReadyState,
  VERCEL_DEPLOYMENT_API_URL,
  vercelDeploymentStatusUrl,
} from '@/lib/deployments';
import {
  applyDeploymentStorageSettings,
  type DeploymentStorageSettings,
} from '@/lib/deployments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type AssistantOptions = {
  systemPrompt?: string;
  enabledTools?: string[];
  enabledMcp?: string[];
  enabledSkills?: string[];
  enabledPlugins?: string[];
  sandboxProvider?: string;
};

type DeployRequest = {
  name?: string;
  provider?: string;
  profile?: 'knowledge' | 'assistant';
  assistantOptions?: AssistantOptions;
  deployConfig?: {
    vectorStore?: DeploymentStorageSettings['vectorStore'];
    storeConfig?: DeploymentStorageSettings['storeConfig'];
    embeddingModelId?: DeploymentStorageSettings['embeddingModelId'];
    chatProvider?: DeploymentStorageSettings['chatProvider'];
    chatModelId?: DeploymentStorageSettings['chatModelId'];
    chatApiKey?: DeploymentStorageSettings['chatApiKey'];
    saveStorageSettings?: boolean;
    envValues?: Record<string, string>;
    apiKey?: string;
    credentials?: {
      vercelToken?: string;
      vercelProject?: string;
      sshHost?: string;
      sshUsername?: string;
      sshAuthType?: 'key' | 'password';
      sshKeyOrPassword?: string;
    };
  };
  checkId?: string;
  updateId?: string;
  endpoint?: string;
};

function envFromFile(file: GeneratedFile | undefined) {
  const values: Record<string, string> = {};
  for (const line of file?.contents.split('\n') ?? []) {
    const index = line.indexOf('=');
    if (index > 0) values[line.slice(0, index)] = line.slice(index + 1);
  }
  return values;
}

function envFile(values: Record<string, string>) {
  return Object.entries(values)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

function deploymentConfig(
  base: RagConfig,
  profile: 'knowledge' | 'assistant',
  options?: AssistantOptions,
  storage?: DeployRequest['deployConfig'],
) {
  const withStorage = applyDeploymentStorageSettings(base, storage);
  if (profile !== 'assistant') return { ...withStorage, runtimeProfile: 'knowledge' as const };
  const selectedSkills = options?.enabledSkills
    ? new Set(options.enabledSkills)
    : null;
  const selectedTools = new Set([
    ...(options?.enabledTools ?? base.enabledTools ?? []),
    ...(options?.enabledPlugins ?? []),
  ]);
  return {
    ...withStorage,
    runtimeProfile: 'assistant' as const,
    systemPrompt: options?.systemPrompt ?? base.systemPrompt,
    enabledTools: [...selectedTools],
    defaultSandboxProvider: options?.sandboxProvider ?? base.defaultSandboxProvider,
    skills: selectedSkills ? (base.skills ?? []).filter((skill) => selectedSkills.has(skill.id)) : base.skills,
  };
}

async function validateSandbox(
  config: RagConfig,
  target: NonNullable<ReturnType<typeof getDeploymentTarget>>,
) {
  if (config.runtimeProfile !== 'assistant') return;
  const tools = await getAllTools();
  const selected = new Set(config.enabledTools ?? []);
  const needsSandbox =
    selected.has('executeAnalysis') ||
    selected.has('analyzeCorpusWithCode') ||
    tools.some((tool) => selected.has(tool.id) && tool.requiresSandbox !== false);
  if (!needsSandbox) return;

  const provider = config.defaultSandboxProvider || 'local';
  if (target.kind === 'serverless' && (provider === 'local' || provider === 'docker')) {
    throw new Error(
      `${target.label} is serverless and cannot run the ${provider} sandbox. Select and verify a remote code-execution provider before deploying this Agent.`,
    );
  }
  if (provider !== 'local' && provider !== 'docker') {
    const descriptor = getSandboxProvider(provider as Parameters<typeof getSandboxProvider>[0]);
    if (!descriptor || descriptor.executionSupport !== 'full') {
      throw new Error('Choose a sandbox provider that supports general code execution.');
    }
    if (!config.sandboxProviderConfigs?.[provider]) {
      throw new Error(`Configure ${descriptor.label} credentials before deploying sandbox-enabled tools.`);
    }
  }
}

async function preparedDeployment(
  base: RagConfig,
  profile: 'knowledge' | 'assistant',
  options: AssistantOptions | undefined,
  storage: DeployRequest['deployConfig'] | undefined,
  envValues: Record<string, string> | undefined,
  apiKey: string | undefined,
) {
  const requested = deploymentConfig(base, profile, options, storage);
  const prepared = await prepareAgentRuntime(requested, {
    mcpConnectionIds: options?.enabledMcp,
    portable: true,
  });
  const generated = generateServer(prepared.config);
  generated.files.push(...prepared.pluginFiles);
  const env = {
    ...envFromFile(generated.files.find((file) => file.path === '.env')),
    ...prepared.env,
    ...envValues,
    ...(apiKey ? { SERVER_API_KEY: apiKey } : {}),
  };
  return { config: prepared.config, generated, env };
}

function vercelError(response: Response, payload: unknown) {
  const message =
    typeof payload === 'object' && payload && 'error' in payload
      ? String((payload as { error?: { message?: string } }).error?.message ?? response.statusText)
      : response.statusText;
  return new Error(`Vercel request failed: ${message}`);
}

type VercelDeploymentDetails = {
  readyState?: string;
  errorMessage?: string;
  errorCode?: string;
};

async function checkVercelDeployment(
  id: string,
  remoteId: string | undefined,
  endpoint: string,
  token: string,
) {
  const fallbackHostname = new URL(endpoint).hostname;
  const response = await fetch(vercelDeploymentStatusUrl(remoteId || fallbackHostname), {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = (await response.json().catch(() => null)) as VercelDeploymentDetails | null;
  if (!response.ok) throw vercelError(response, payload);
  const status = deploymentStatusFromVercelReadyState(payload?.readyState);
  const statusMessage =
    status === 'error'
      ? payload?.errorMessage || payload?.errorCode || 'Vercel marked this deployment as failed.'
      : status === 'unknown'
      ? 'Vercel returned an unrecognized deployment state.'
      : undefined;
  return updateDeploymentStatus(id, status, statusMessage);
}

async function upsertVercelEnvironment(token: string, project: string, env: Record<string, string>) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const existingResponse = await fetch(`https://api.vercel.com/v9/projects/${project}/env`, { headers });
  const existingPayload = await existingResponse.json().catch(() => null);
  if (!existingResponse.ok) throw vercelError(existingResponse, existingPayload);
  const existing = new Map(
    ((existingPayload as { envs?: Array<{ id: string; key: string; target?: string[] }> } | null)?.envs ?? []).map(
      (value) => [value.key, value],
    ),
  );

  for (const [key, value] of Object.entries(env).filter(([, value]) => value)) {
    const previous = existing.get(key);
    const response = await fetch(
      previous
        ? `https://api.vercel.com/v9/projects/${project}/env/${previous.id}`
        : `https://api.vercel.com/v9/projects/${project}/env`,
      {
        method: previous ? 'PATCH' : 'POST',
        headers,
        body: JSON.stringify({ key, value, type: 'encrypted', target: ['production'] }),
      },
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw vercelError(response, payload);
  }
}

async function deployToVercel(
  token: string,
  project: string,
  files: GeneratedFile[],
  env: Record<string, string>,
) {
  if (!token || !project) throw new Error('Vercel token and project are required.');
  await upsertVercelEnvironment(token, project, env);
  const deploymentFiles = files
    .filter((file) => file.path !== '.env')
    .map((file) => ({
      file: file.path,
      data:
        file.encoding === 'base64'
          ? file.contents
          : Buffer.from(file.contents, 'utf8').toString('base64'),
      encoding: 'base64',
    }));
  const response = await fetch(VERCEL_DEPLOYMENT_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: project, project, target: 'production', files: deploymentFiles }),
  });
  const payload = (await response.json().catch(() => null)) as { url?: string; id?: string } | null;
  if (!response.ok || !payload?.url) throw vercelError(response, payload);
  return { endpoint: `https://${payload.url}`, remoteId: payload.id };
}

async function deployToSsh(
  target: NonNullable<ReturnType<typeof getDeploymentTarget>>,
  credentials: NonNullable<DeployRequest['deployConfig']>['credentials'],
  files: GeneratedFile[],
  env: Record<string, string>,
) {
  const host = credentials?.sshHost?.trim();
  const username = credentials?.sshUsername?.trim();
  const secret = credentials?.sshKeyOrPassword;
  if (!host || !username || !secret) throw new Error('SSH host, username, and credentials are required.');
  const deploymentId = randomUUID();
  const temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'larkup-deployment-'));
  const ssh = new NodeSSH();
  try {
    for (const file of files.filter((file) => file.path !== '.env')) {
      const destination = path.join(temporaryDir, file.path);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(
        destination,
        file.encoding === 'base64' ? Buffer.from(file.contents, 'base64') : file.contents,
      );
    }
    await fs.writeFile(path.join(temporaryDir, '.env'), envFile(env), 'utf8');
    await ssh.connect({
      host,
      username,
      [credentials?.sshAuthType === 'key' ? 'privateKey' : 'password']: secret,
      readyTimeout: 15_000,
    });
    const preflight = await ssh.execCommand('docker compose version');
    if (preflight.code !== 0) {
      throw new Error(
        `${target.label} must have Docker Engine and Docker Compose installed before Larkup can prepare the Agent runtime.`,
      );
    }
    const home = await ssh.execCommand('printf %s "$HOME"');
    if (home.code !== 0 || !home.stdout.trim()) {
      throw new Error('Could not resolve the SSH user home directory.');
    }
    const remoteDir = path.posix.join(home.stdout.trim(), '.larkup', 'deployments', deploymentId);
    const created = await ssh.execCommand(`mkdir -p ${remoteDir}`);
    if (created.code !== 0) throw new Error(created.stderr || 'Could not create the deployment directory.');
    const uploaded = await ssh.putDirectory(temporaryDir, remoteDir, { recursive: true, concurrency: 4 });
    if (!uploaded) throw new Error('Could not upload the generated Agent runtime.');
    const started = await ssh.execCommand('docker compose up -d --build', { cwd: remoteDir });
    if (started.code !== 0) throw new Error(started.stderr || 'Docker could not start the Agent runtime.');
    return { endpoint: deploymentEndpointForHost(host), remoteId: deploymentId };
  } finally {
    ssh.dispose();
    await fs.rm(temporaryDir, { recursive: true, force: true });
  }
}

export async function GET() {
  return NextResponse.json({ deployments: await readDeployments() });
}

export async function DELETE(request: Request) {
  const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
  if (typeof body?.id !== 'string' || !body.id) {
    return NextResponse.json({ error: 'A deployment id is required.' }, { status: 400 });
  }
  const deleted = await deleteDeployment(body.id);
  return deleted
    ? NextResponse.json({ deleted: true })
    : NextResponse.json({ error: 'Deployment not found.' }, { status: 404 });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as DeployRequest | null;
  if (body?.checkId) {
    const current = (await readDeployments()).find((deployment) => deployment.id === body.checkId);
    if (!current) return NextResponse.json({ error: 'Deployment not found.' }, { status: 404 });
    try {
      const vercelToken = body.deployConfig?.credentials?.vercelToken;
      const deployment =
        current.provider === 'Vercel' && vercelToken
          ? await checkVercelDeployment(current.id, current.remoteId, current.endpoint, vercelToken)
          : await checkDeployment(current.id);
      return deployment
        ? NextResponse.json({ deployment })
        : NextResponse.json({ error: 'Deployment not found.' }, { status: 404 });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Could not check this deployment.' },
        { status: 422 },
      );
    }
  }
  if (body?.updateId) {
    let endpoint: URL;
    try {
      endpoint = new URL(body.endpoint ?? '');
    } catch {
      return NextResponse.json({ error: 'Enter a valid deployment endpoint.' }, { status: 400 });
    }
    if (!['http:', 'https:'].includes(endpoint.protocol)) {
      return NextResponse.json({ error: 'Endpoint must use HTTP or HTTPS.' }, { status: 400 });
    }
    const deployment = await updateDeploymentEndpoint(
      body.updateId,
      endpoint.toString().replace(/\/$/, ''),
    );
    return deployment
      ? NextResponse.json({ deployment })
      : NextResponse.json({ error: 'Deployment not found.' }, { status: 404 });
  }
  const target = getDeploymentTarget(body?.provider);
  if (!target || !body?.profile) {
    return NextResponse.json({ error: 'Choose a supported deployment target and profile.' }, { status: 400 });
  }

  try {
    const config = await readConfig();
    const { config: runtimeConfig, generated, env } = await preparedDeployment(
      config,
      body.profile,
      body.assistantOptions,
      body.deployConfig,
      body.deployConfig?.envValues,
      body.deployConfig?.apiKey,
    );
    await validateSandbox(runtimeConfig, target);
    if (body.deployConfig?.saveStorageSettings !== false) {
      await writeConfig({
        ...config,
        vectorStore: runtimeConfig.vectorStore,
        storeConfig: runtimeConfig.storeConfig,
        embeddingModelId: runtimeConfig.embeddingModelId,
      });
    }
    const result =
      target.kind === 'serverless'
        ? await deployToVercel(
            body.deployConfig?.credentials?.vercelToken || '',
            body.deployConfig?.credentials?.vercelProject || '',
            generated.files,
            env,
          )
        : await deployToSsh(target, body.deployConfig?.credentials, generated.files, env);
    const deployment = await saveDeployment({
      name: body.name?.trim() || `${target.label} ${body.profile === 'assistant' ? 'Agent' : 'Knowledge'}`,
      provider: target.id,
      profile: body.profile,
      endpoint: result.endpoint,
      remoteId: result.remoteId,
      ...(body.profile === 'assistant' && body.assistantOptions
        ? { assistantOptions: body.assistantOptions }
        : {}),
    });
    return NextResponse.json({ deployment, remoteId: result.remoteId }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not deploy the runtime.' },
      { status: 422 },
    );
  }
}
