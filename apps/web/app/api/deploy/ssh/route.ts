import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { NodeSSH } from 'node-ssh';
import { readConfig, writeConfig } from '@larkup/core/config-store';
import { saveDeployment } from '@larkup/core/deployments-store';
import { prepareAgentRuntime } from '@larkup/core/generator/server-runtime';
import { generateServer, type GeneratedFile } from '@larkup/core/generator/generate-server';
import type { RagConfig } from '@larkup/core/types';
import {
  applyDeploymentStorageSettings,
  deploymentEndpointForHost,
  getDeploymentTarget,
} from '@/lib/deployments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function envFile(values: Record<string, string>) {
  return Object.entries(values)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
}

function envFromFile(file: GeneratedFile | undefined) {
  const values: Record<string, string> = {};
  for (const line of file?.contents.split('\n') ?? []) {
    const idx = line.indexOf('=');
    if (idx > 0) values[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return values;
}

function sseMessage(data: object) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

async function execStream(
  ssh: NodeSSH,
  command: string,
  onLine: (line: string) => void,
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    let stderr = '';
    (ssh.connection as any).exec(command, { pty: true }, (err: Error | undefined, stream: any) => {
      if (err) {
        resolve({ code: 1, stderr: err.message });
        return;
      }
      stream.on('data', (chunk: Buffer) => {
        for (const line of chunk.toString().split(/\r?\n/)) {
          if (line.trim()) onLine(line);
        }
      });
      stream.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      stream.on('close', (exitCode: number) => resolve({ code: exitCode ?? 0, stderr }));
    });
  });
}

async function deployViaSSH(opts: {
  target: NonNullable<ReturnType<typeof getDeploymentTarget>>;
  host: string;
  username: string;
  authType: 'key' | 'password';
  secret: string;
  newPassword?: string;
  files: GeneratedFile[];
  env: Record<string, string>;
  emit: (data: object) => void;
}): Promise<{ endpoint: string; deploymentId: string }> {
  const { host, username, authType, secret, newPassword, files, env, emit } = opts;
  const log = (msg: string) => emit({ type: 'log', message: msg });
  const ssh = new NodeSSH();
  const temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'larkup-vps-'));

  try {
    log(`Connecting to ${username}@${host} via SSH...`);
    try {
      await ssh.connect({
        host,
        username,
        [authType === 'key' ? 'privateKey' : 'password']: secret,
        readyTimeout: 20_000,
      });
    } catch (err: any) {
      const msg: string = (err?.message || err?.level || '').toLowerCase();
      if (
        msg.includes('password') &&
        (msg.includes('expired') || msg.includes('change') || msg.includes('must'))
      ) {
        emit({ type: 'password_change_required' });
        throw new Error('password_change_required');
      }
      throw err;
    }
    log('Connected successfully.');

    if (newPassword) {
      log('Changing server password...');
      const r = await ssh.execCommand(`echo "${username}:${newPassword}" | sudo chpasswd`);
      if (r.code !== 0)
        await ssh.execCommand(`echo -e "${secret}\n${newPassword}\n${newPassword}" | passwd`);
      log('Password changed successfully.');
      emit({ type: 'password_changed', newPassword });
      ssh.dispose();
      log('Reconnecting with new password...');
      await ssh.connect({ host, username, password: newPassword, readyTimeout: 20_000 });
      log('Reconnected successfully.');
    }

    log('Checking for Docker...');
    const dockerCheck = await ssh.execCommand('docker --version');
    if (dockerCheck.code !== 0) {
      log('Docker not found. Installing Docker Engine (this may take a few minutes)...');
      log('$ curl -fsSL https://get.docker.com | sh');
      const { code, stderr } = await execStream(ssh, 'curl -fsSL https://get.docker.com | sh', log);
      if (code !== 0) throw new Error(`Docker install failed: ${stderr || 'unknown error'}`);
      log('Docker Engine installed.');
    } else {
      log(`Docker found: ${dockerCheck.stdout.trim()}`);
    }

    log('Checking for Docker Compose...');
    const composeCheck = await ssh.execCommand('docker compose version');
    if (composeCheck.code !== 0) {
      log('Docker Compose not found. Installing...');
      const { code } = await execStream(
        ssh,
        'apt-get update -qq && apt-get install -y -qq docker-compose-plugin',
        log,
      );
      if (code !== 0) {
        log('Trying standalone Compose binary...');
        await execStream(
          ssh,
          `curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose && chmod +x /usr/local/bin/docker-compose`,
          log,
        );
      }
      log('Docker Compose installed.');
    } else {
      log(`Docker Compose found: ${composeCheck.stdout.trim()}`);
    }

    log('Preparing Agent runtime files...');
    for (const file of files.filter((f) => f.path !== '.env')) {
      const dest = path.join(temporaryDir, file.path);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(
        dest,
        file.encoding === 'base64' ? Buffer.from(file.contents, 'base64') : file.contents,
      );
    }
    await fs.writeFile(path.join(temporaryDir, '.env'), envFile(env), 'utf8');

    const homeResult = await ssh.execCommand(`printf %s "$HOME"`);
    if (homeResult.code !== 0 || !homeResult.stdout.trim())
      throw new Error('Could not resolve SSH home directory.');
    const deploymentId = randomUUID();
    const remoteDir = path.posix.join(
      homeResult.stdout.trim(),
      '.larkup',
      'deployments',
      deploymentId,
    );
    log('Creating deployment directory on server...');
    const mkResult = await ssh.execCommand(`mkdir -p ${remoteDir}`);
    if (mkResult.code !== 0)
      throw new Error(mkResult.stderr || 'Could not create deployment directory.');

    log('Uploading runtime files to server...');
    const uploaded = await ssh.putDirectory(temporaryDir, remoteDir, {
      recursive: true,
      concurrency: 4,
      validate: () => true, // Allow dotfiles like .env
    });
    if (!uploaded) throw new Error('Could not upload Agent runtime files.');
    log('Files uploaded successfully.');

    log('Starting Agent runtime...');
    log('$ docker compose up -d --build');
    const { code: startCode, stderr: startStderr } = await execStream(
      ssh,
      `cd ${remoteDir} && docker compose up -d --build`,
      log,
    );
    if (startCode !== 0) throw new Error(startStderr || 'Docker Compose failed to start.');
    log('Agent runtime is live!');

    return { endpoint: deploymentEndpointForHost(host), deploymentId };
  } finally {
    ssh.dispose();
    await fs.rm(temporaryDir, { recursive: true, force: true });
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as any;
  const target = getDeploymentTarget(body?.provider);
  if (!target || target.kind !== 'vps') {
    return new Response(
      sseMessage({ type: 'error', error: 'Invalid or non-VPS deployment target.' }),
      {
        status: 400,
        headers: { 'Content-Type': 'text/event-stream' },
      },
    );
  }

  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const emit = (data: object) => writer.write(encoder.encode(sseMessage(data))).catch(() => {});

  (async () => {
    try {
      const config = (await readConfig()) as RagConfig;
      const dc = body?.deployConfig;
      const requested = applyDeploymentStorageSettings(config, dc);
      const prepared = await prepareAgentRuntime(
        { ...requested, runtimeProfile: body?.profile === 'assistant' ? 'assistant' : 'knowledge' },
        { mcpConnectionIds: dc?.enabledMcp ?? [], portable: true },
      );
      const generated = generateServer(prepared.config);
      generated.files.push(...prepared.pluginFiles);
      const env: Record<string, string> = {
        ...envFromFile(generated.files.find((f) => f.path === '.env')),
        ...prepared.env,
        ...(dc?.envValues ?? {}),
        ...(dc?.apiKey ? { SERVER_API_KEY: dc.apiKey } : {}),
      };

      if (dc?.saveStorageSettings !== false) {
        await writeConfig({
          ...config,
          vectorStore: prepared.config.vectorStore,
          storeConfig: prepared.config.storeConfig,
          embeddingModelId: prepared.config.embeddingModelId,
        });
      }

      const creds = dc?.credentials ?? {};
      const host = (creds.sshHost ?? '').trim();
      const username = (creds.sshUsername ?? 'root').trim();
      const authType: 'key' | 'password' = creds.sshAuthType ?? 'password';
      const secret = creds.sshKeyOrPassword ?? '';
      if (!host || !secret) {
        emit({ type: 'error', error: 'SSH host and credentials are required.' });
        return;
      }

      const { endpoint, deploymentId } = await deployViaSSH({
        target,
        host,
        username,
        authType,
        secret,
        newPassword: creds.newPassword,
        files: generated.files,
        env,
        emit,
      });

      await saveDeployment({
        name: `${target.label} ${body?.profile === 'assistant' ? 'Agent' : 'Knowledge'}`,
        provider: target.id,
        profile: body?.profile ?? 'knowledge',
        endpoint,
        remoteId: deploymentId,
      });

      emit({ type: 'done', success: true, url: endpoint });
    } catch (err: any) {
      if (err?.message !== 'password_change_required') {
        emit({ type: 'error', error: err?.message || 'Deployment failed.' });
      }
    } finally {
      writer.close().catch(() => {});
    }
  })();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
