import { execFile, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { getProjectDataDir, requireProjectDataDir } from '@larkup/core/project-store';

const execFileAsync = promisify(execFile);
const AGENT_API_URL = 'http://127.0.0.1:4040/api/tunnels';
const START_TIMEOUT_MS = 10_000;

type StoredTunnel = {
  pid?: number;
  port: number;
  publicUrl?: string;
  startedAt?: string;
};

type AgentTunnel = {
  public_url?: string;
  config?: { addr?: string };
};

export type LocalTunnelStatus = {
  status: 'running' | 'stopped' | 'unavailable';
  publicUrl?: string;
  detail: string;
};

async function statePath(create: boolean): Promise<string | null> {
  const directory = create ? await requireProjectDataDir() : await getProjectDataDir();
  return directory ? path.join(directory, 'public-webhook-tunnel.json') : null;
}

async function readStoredTunnel(): Promise<StoredTunnel | null> {
  const file = await statePath(false);
  if (!file) return null;
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as StoredTunnel;
  } catch {
    return null;
  }
}

async function writeStoredTunnel(value: StoredTunnel): Promise<void> {
  const file = await statePath(true);
  if (file) await fs.writeFile(file, JSON.stringify(value, null, 2), 'utf8');
}

function pidAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function agentTunnelUrl(tunnels: AgentTunnel[], port: number): string | undefined {
  const expectedPort = String(port);
  return tunnels.find((tunnel) => {
    const address = tunnel.config?.addr ?? '';
    return address === expectedPort || address.endsWith(`:${expectedPort}`);
  })?.public_url;
}

async function readAgentTunnelUrl(port: number): Promise<string | undefined> {
  try {
    const response = await fetch(AGENT_API_URL, { signal: AbortSignal.timeout(1_000) });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { tunnels?: AgentTunnel[] };
    const url = agentTunnelUrl(body.tunnels ?? [], port);
    return url?.startsWith('https://') ? url : undefined;
  } catch {
    return undefined;
  }
}

async function ngrokIsInstalled(): Promise<boolean> {
  try {
    await execFileAsync('ngrok', ['version'], { timeout: 3_000 });
    return true;
  } catch {
    return false;
  }
}

function publicTunnelUnavailable(): LocalTunnelStatus {
  return {
    status: 'unavailable',
    detail: 'Public tunnels can only be started from a local Larkup installation.',
  };
}

/**
 * Resolves the port of a local Larkup web app from its incoming request.
 *
 * The tunnel deliberately exposes the web app rather than an Agent endpoint:
 * provider webhooks are received by this app under `/api/connections/*` and
 * then routed to whichever local or deployed Agent the connection selected.
 */
export function localWebPort(request: Request): number | null {
  if (process.env.VERCEL === '1') return null;
  const url = new URL(request.url);
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) return null;
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : null;
}

/** Returns the public HTTPS URL, if ngrok is currently forwarding this Project's web port. */
export async function getLocalTunnelStatus(port: number | null): Promise<LocalTunnelStatus> {
  if (!port) return publicTunnelUnavailable();
  const publicUrl = await readAgentTunnelUrl(port);
  if (publicUrl) {
    return { status: 'running', publicUrl, detail: 'Public HTTPS tunnel is running.' };
  }

  const stored = await readStoredTunnel();
  if (stored?.port === port && pidAlive(stored.pid)) {
    return {
      status: 'stopped',
      detail: 'ngrok is starting. Refresh in a moment if this message remains.',
    };
  }
  return { status: 'stopped', detail: 'Start a public HTTPS tunnel to receive channel webhooks.' };
}

/**
 * Starts an ngrok HTTPS tunnel to the local Larkup web app.
 *
 * An optional authtoken is written only to ngrok's own local configuration,
 * never to a Project record or returned to the browser. Subsequent starts use
 * the existing ngrok configuration.
 */
export async function startLocalTunnel(
  port: number | null,
  authtoken?: string,
): Promise<LocalTunnelStatus> {
  if (!port) return publicTunnelUnavailable();
  const existing = await getLocalTunnelStatus(port);
  if (existing.status === 'running') return existing;
  if (!(await ngrokIsInstalled())) {
    return {
      status: 'unavailable',
      detail: 'Install ngrok on this computer, then add its authtoken before starting a tunnel.',
    };
  }

  const token = authtoken?.trim();
  if (token) {
    try {
      await execFileAsync('ngrok', ['config', 'add-authtoken', token], { timeout: 10_000 });
    } catch {
      return {
        status: 'unavailable',
        detail: 'ngrok could not save that authtoken. Check it and try again.',
      };
    }
  }

  const child = spawn('ngrok', ['http', `http://127.0.0.1:${port}`], {
    detached: true,
    stdio: 'ignore',
  });
  const spawned = await new Promise<boolean>((resolve) => {
    child.once('spawn', () => resolve(true));
    child.once('error', () => resolve(false));
  });
  if (!spawned) {
    return {
      status: 'unavailable',
      detail: 'ngrok could not start on this computer. Reinstall it, then try again.',
    };
  }
  child.unref();

  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const publicUrl = await readAgentTunnelUrl(port);
    if (publicUrl) {
      await writeStoredTunnel({
        pid: child.pid,
        port,
        publicUrl,
        startedAt: new Date().toISOString(),
      });
      return { status: 'running', publicUrl, detail: 'Public HTTPS tunnel is running.' };
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  if (child.pid && pidAlive(child.pid)) {
    try {
      process.kill(child.pid, 'SIGTERM');
    } catch {
      // The process may have exited between the health check and this cleanup.
    }
  }
  return {
    status: 'unavailable',
    detail: 'ngrok did not create a public HTTPS address. Add a valid authtoken, then try again.',
  };
}

/** Stops the ngrok process Larkup started for the active Project, if it is still running. */
export async function stopLocalTunnel(port: number | null): Promise<LocalTunnelStatus> {
  if (!port) return publicTunnelUnavailable();
  const stored = await readStoredTunnel();
  if (stored?.port === port && pidAlive(stored.pid)) {
    try {
      process.kill(stored.pid!, 'SIGTERM');
    } catch {
      // A stopped process is equivalent to the desired result.
    }
  }
  const file = await statePath(false);
  if (file) await fs.rm(file, { force: true });
  return { status: 'stopped', detail: 'Public HTTPS tunnel stopped.' };
}
