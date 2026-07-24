import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn, exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { RagConfig } from '../types';
import { generateServer } from './generate-server';
import { generateAgentServer } from './generate-agent-server';
import { getActiveServer, getDataDir, requireDataDir } from '../workspace';

/**
 * Launches a server's GENERATED RAG server locally as a detached Node process.
 */

const execAsync = promisify(exec);
const FALLBACK_PORT = 8080;

/** Kill any process listening on the given TCP port (best-effort). */
async function killPort(port: number): Promise<void> {
  try {
    const { stdout } = await execAsync(`lsof -ti tcp:${port}`);
    const pids = stdout
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const pid of pids) {
      try {
        process.kill(Number(pid), 9);
      } catch {
        /* already gone */
      }
    }
    // Give OS a moment to release the port
    await new Promise((r) => setTimeout(r, 300));
  } catch {}
}

export interface LocalServerState {
  running: boolean;
  pid?: number;
  port: number;
  endpoint: string;
  generatedAt?: string;
  startedAt?: string;
  lastError?: string;
}

async function resolvePort(): Promise<number> {
  const server = await getActiveServer();
  return server?.port ?? FALLBACK_PORT;
}

function emptyState(port: number): LocalServerState {
  return {
    running: false,
    port,
    endpoint: `http://localhost:${port}`,
  };
}

async function agentOutDir(create: boolean): Promise<string | null> {
  const dir = create ? await requireDataDir() : await getDataDir();
  if (!dir) return null;
  return path.join(dir, 'generated-agent-server');
}

async function agentStatePath(create: boolean): Promise<string | null> {
  const dir = create ? await requireDataDir() : await getDataDir();
  if (!dir) return null;
  return path.join(dir, 'agent-server-local.json');
}

async function outDir(create: boolean): Promise<string | null> {
  const dir = create ? await requireDataDir() : await getDataDir();
  if (!dir) return null;
  return path.join(dir, 'generated-server');
}

async function statePath(create: boolean): Promise<string | null> {
  const dir = create ? await requireDataDir() : await getDataDir();
  if (!dir) return null;
  return path.join(dir, 'server-local.json');
}

export async function readServerState(): Promise<LocalServerState> {
  const port = await resolvePort();
  const file = await statePath(false);
  if (!file) return emptyState(port);
  try {
    const raw = await fs.readFile(file, 'utf8');
    return { ...emptyState(port), ...(JSON.parse(raw) as Partial<LocalServerState>), port };
  } catch {
    return emptyState(port);
  }
}

async function writeState(state: LocalServerState) {
  const file = await statePath(true);
  if (file) await fs.writeFile(file, JSON.stringify(state, null, 2), 'utf8');
  return state;
}

/** Is a pid still alive? */
function pidAlive(pid?: number): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Write the generated server files to disk (always refreshes the output). */
export async function emitToDisk(config: RagConfig): Promise<string> {
  const server = generateServer(config);
  const dir = await outDir(true);
  if (!dir) throw new Error('No active server to emit to.');
  await fs.mkdir(dir, { recursive: true });
  for (const file of server.files) {
    const dest = path.join(dir, file.path);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    if (file.encoding === 'base64') {
      await fs.writeFile(dest, Buffer.from(file.contents, 'base64'));
    } else {
      await fs.writeFile(dest, file.contents, 'utf8');
    }
  }
  return dir;
}

async function isHealthy(endpoint: string): Promise<boolean> {
  try {
    const res = await fetch(`${endpoint}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Launch the generated server locally.
 */
export async function startServer(
  config: RagConfig,
  serverApiKey?: string,
): Promise<LocalServerState> {
  const port = await resolvePort();
  const endpoint = `http://localhost:${port}`;

  const prev = await readServerState();
  if (prev.pid && pidAlive(prev.pid)) {
    try {
      process.kill(prev.pid, 9);
    } catch {
      /* already gone */
    }
  }
  await killPort(port);

  const dir = await emitToDisk(config);

  // Install minimal deps (idempotent).
  try {
    await execAsync('npm install --omit=dev', {
      cwd: dir,
      timeout: 240_000,
      env: {
        ...process.env,
        HOME: process.env.HOME || dir,
        npm_config_cache: path.join(dir, '.npm-cache'),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'npm install failed';
    return writeState({ ...emptyState(port), lastError: message });
  }

  const dbPath = config.storeConfig.dbPath || './.larkup/lancedb';
  const absDb = path.isAbsolute(dbPath) ? dbPath : path.join(process.cwd(), dbPath);

  const logPath = path.join(dir, 'server.log');
  await fs.writeFile(logPath, '', 'utf8');
  const logFd = await fs.open(logPath, 'a');
  const script = ['server', 'mjs'].join('.');
  const child = spawn('node', [script], {
    cwd: dir,
    detached: true,
    stdio: ['ignore', logFd.fd, logFd.fd],
    env: {
      ...process.env,
      PORT: String(port),
      TOP_K: String(config.topK),
      SERVER_API_KEY: serverApiKey || '',
      EMBEDDING_API_KEY:
        config.embeddingApiKey || process.env.EMBEDDING_API_KEY || process.env.OPENAI_API_KEY || '',
      CHAT_API_KEY:
        config.chatApiKey || process.env.CHAT_API_KEY || process.env.OPENAI_API_KEY || '',
      OPENAI_API_KEY:
        config.embeddingApiKey || config.chatApiKey || process.env.OPENAI_API_KEY || '',
      ANTHROPIC_API_KEY:
        config.chatApiKey || config.embeddingApiKey || process.env.ANTHROPIC_API_KEY || '',
      COHERE_API_KEY:
        config.embeddingApiKey || config.chatApiKey || process.env.COHERE_API_KEY || '',
      GOOGLE_GENERATIVE_AI_API_KEY:
        config.embeddingApiKey ||
        config.chatApiKey ||
        process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
        '',
      PINECONE_API_KEY: config.storeConfig.apiKey || '',
      PINECONE_INDEX: config.storeConfig.indexName || '',
      PINECONE_NAMESPACE: config.storeConfig.namespace || '',
      PINECONE_SPARSE_MODEL: config.storeConfig.sparseModel || '',
      PINECONE_SPARSE_INDEX: config.storeConfig.sparseIndexName || '',
      LANCEDB_MODE: config.storeConfig.mode || 'local',
      LANCEDB_PATH: absDb,
      LANCEDB_URI: config.storeConfig.uri || '',
      LANCEDB_API_KEY: config.storeConfig.apiKey || '',
      LANCEDB_S3_URI: config.storeConfig.s3Uri || '',
      AWS_ENDPOINT: config.storeConfig.s3Endpoint || '',
      AWS_REGION: config.storeConfig.s3Region || '',
      AWS_ACCESS_KEY_ID: config.storeConfig.s3AccessKeyId || '',
      AWS_SECRET_ACCESS_KEY: config.storeConfig.s3SecretAccessKey || '',
      LANCEDB_TABLE: config.storeConfig.tableName || 'documents',
    },
  });
  console.log(
    'Starting child process with OPENAI_API_KEY:',
    !!(config.embeddingApiKey || config.chatApiKey || process.env.OPENAI_API_KEY),
  );
  child.unref();
  await logFd.close();

  const healthy = await waitForHealth(endpoint, 20_000);

  let lastError: string | undefined = undefined;
  if (!healthy) {
    lastError =
      'The AI server failed to start within the expected time limit. Please try restarting.';
    try {
      const logs = await fs.readFile(logPath, 'utf8');
      const trimmed = logs.trim();
      if (trimmed) {
        const lastLines = trimmed.split('\n').slice(-5).join('\n');
        lastError = `The AI server failed to start. Error details:\n${lastLines}`;
      }
    } catch (err) {
      // ignore
    }
  }

  return writeState({
    running: healthy,
    pid: child.pid,
    port,
    endpoint,
    generatedAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    lastError,
  });
}

export async function readAgentServerState(): Promise<LocalServerState> {
  const port = 8081;
  const file = await agentStatePath(false);
  if (!file) return emptyState(port);
  try {
    const raw = await fs.readFile(file, 'utf8');
    return { ...emptyState(port), ...(JSON.parse(raw) as Partial<LocalServerState>), port };
  } catch {
    return emptyState(port);
  }
}

async function writeAgentState(state: LocalServerState) {
  const file = await agentStatePath(true);
  if (file) await fs.writeFile(file, JSON.stringify(state, null, 2), 'utf8');
  return state;
}

export async function emitAgentToDisk(config: RagConfig): Promise<string> {
  const server = generateAgentServer(config);
  const dir = await agentOutDir(true);
  if (!dir) throw new Error('No active server to emit to.');
  await fs.mkdir(dir, { recursive: true });
  for (const file of server.files) {
    const dest = path.join(dir, file.path);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    if (file.encoding === 'base64') {
      await fs.writeFile(dest, Buffer.from(file.contents, 'base64'));
    } else {
      await fs.writeFile(dest, file.contents, 'utf8');
    }
  }
  return dir;
}

export async function startAgentServer(
  config: RagConfig,
  serverApiKey?: string,
): Promise<LocalServerState> {
  const port = 8081;
  const endpoint = `http://localhost:${port}`;

  const prev = await readAgentServerState();
  if (prev.pid && pidAlive(prev.pid)) {
    try {
      process.kill(prev.pid, 9);
    } catch {
      /* already gone */
    }
  }
  await killPort(port);

  const dir = await emitAgentToDisk(config);

  try {
    await execAsync('npm install --omit=dev', {
      cwd: dir,
      timeout: 240_000,
      env: {
        ...process.env,
        HOME: process.env.HOME || dir,
        npm_config_cache: path.join(dir, '.npm-cache'),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'npm install failed';
    return writeAgentState({ ...emptyState(port), lastError: message });
  }

  const dbPath = config.storeConfig.dbPath || './.larkup/lancedb';
  const absDb = path.isAbsolute(dbPath) ? dbPath : path.join(process.cwd(), dbPath);

  const logPath = path.join(dir, 'server.log');
  await fs.writeFile(logPath, '', 'utf8');
  const logFd = await fs.open(logPath, 'a');
  const script = ['server', 'mjs'].join('.');
  const child = spawn('node', [script], {
    cwd: dir,
    detached: true,
    stdio: ['ignore', logFd.fd, logFd.fd],
    env: {
      ...process.env,
      PORT: String(port),
      TOP_K: String(config.topK),
      SERVER_API_KEY: serverApiKey || '',
      AGENT_AUTH_MODE: config.deployment?.authMode || 'none',
      AGENT_JOIN_CODE: config.deployment?.joinCode || '',
      CHAT_API_KEY:
        config.deployment?.chatApiKey || config.chatApiKey || process.env.OPENAI_API_KEY || '',
      EMBEDDING_API_KEY:
        config.embeddingApiKey || process.env.EMBEDDING_API_KEY || process.env.OPENAI_API_KEY || '',
      OPENAI_API_KEY:
        config.embeddingApiKey || config.chatApiKey || process.env.OPENAI_API_KEY || '',
      PINECONE_API_KEY: config.storeConfig.apiKey || '',
      PINECONE_INDEX: config.storeConfig.indexName || '',
      PINECONE_NAMESPACE: config.storeConfig.namespace || '',
      PINECONE_SPARSE_MODEL: config.storeConfig.sparseModel || '',
      PINECONE_SPARSE_INDEX: config.storeConfig.sparseIndexName || '',
      LANCEDB_MODE: config.storeConfig.mode || 'local',
      LANCEDB_PATH: absDb,
      LANCEDB_URI: config.storeConfig.uri || '',
      LANCEDB_API_KEY: config.storeConfig.apiKey || '',
      LANCEDB_S3_URI: config.storeConfig.s3Uri || '',
      AWS_ENDPOINT: config.storeConfig.s3Endpoint || '',
      AWS_REGION: config.storeConfig.s3Region || '',
      AWS_ACCESS_KEY_ID: config.storeConfig.s3AccessKeyId || '',
      AWS_SECRET_ACCESS_KEY: config.storeConfig.s3SecretAccessKey || '',
      LANCEDB_TABLE: config.storeConfig.tableName || 'documents',
    },
  });

  child.unref();
  await logFd.close();

  const healthy = await waitForHealth(endpoint, 20_000);

  let lastError: string | undefined = undefined;
  if (!healthy) {
    lastError = 'The AI agent server failed to start.';
    try {
      const logs = await fs.readFile(logPath, 'utf8');
      const trimmed = logs.trim();
      if (trimmed) {
        const lastLines = trimmed.split('\n').slice(-5).join('\n');
        lastError = `The AI agent server failed to start. Error details:\n${lastLines}`;
      }
    } catch (err) {}
  }

  return writeAgentState({
    running: healthy,
    pid: child.pid,
    port,
    endpoint,
    generatedAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    lastError,
  });
}

export async function stopAgentServer(): Promise<LocalServerState> {
  const state = await readAgentServerState();
  const port = state.port || 8081;
  if (state.pid && pidAlive(state.pid)) {
    try {
      process.kill(state.pid, 9);
    } catch {}
  }
  await killPort(port);
  return writeAgentState({
    ...state,
    running: false,
    pid: undefined,
    startedAt: undefined,
  });
}

export async function refreshAgentServerStatus(): Promise<LocalServerState> {
  const state = await readAgentServerState();
  if (!state.startedAt) return state;
  const alive = pidAlive(state.pid) && (await isHealthy(state.endpoint));
  if (alive !== state.running) {
    return writeAgentState({ ...state, running: alive });
  }
  return state;
}

export async function stopServer(): Promise<LocalServerState> {
  const state = await readServerState();
  const port = state.port || FALLBACK_PORT;
  // Kill the tracked pid
  if (state.pid && pidAlive(state.pid)) {
    try {
      process.kill(state.pid, 9);
    } catch {
      /* already gone */
    }
  }
  // Kill anything still on the port (detached orphans)
  await killPort(port);
  return writeState({
    ...state,
    running: false,
    pid: undefined,
    startedAt: undefined,
  });
}

export async function refreshServerStatus(): Promise<LocalServerState> {
  const state = await readServerState();
  if (!state.startedAt) return state;
  const alive = pidAlive(state.pid) && (await isHealthy(state.endpoint));
  if (alive !== state.running) {
    return writeState({ ...state, running: alive });
  }
  return state;
}

async function waitForHealth(endpoint: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isHealthy(endpoint)) return true;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}
