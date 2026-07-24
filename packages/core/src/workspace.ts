import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import net from 'node:net';
import { DEFAULT_CONFIG, type RagConfig } from './types';

/**
 * Workspace layer — turns the toolkit from a single implicit pipeline into a
 * multi-"server" workspace. Each server is a self-contained RAG project with
 * its own config, corpus, ETL jobs, index run, vector data, generated artifact
 * and (its own port for a) running instance.
 *
 * Layout on disk:
 *   .larkup/
 *     workspace.json                 ← username + servers[] + activeServerId
 *     servers/<id>/
 *       config.json
 *       documents.json
 *       jobs.json
 *       index-run.json
 *       server-local.json
 *       lancedb/                     ← vector data
 *       generated-server/            ← emitted deployable server
 *
 * Most stores resolve "which server" from the persisted activeServerId. A
 * request can override that for a single async scope via `runWithServer` —
 * this is how the Demo stage queries any server without threading a serverId
 * through every store function.
 */

export interface ServerMeta {
  id: string;
  name: string;
  /** local port assigned to this server's generated instance */
  port: number;
  createdAt: string;
  updatedAt: string;
}

export type WorkspaceMode = 'tech' | 'simple';

export interface Workspace {
  username: string | null;
  activeServerId: string | null;
  servers: ServerMeta[];
  /** User-selected mode: tech (full pipeline) or simple (guided 3-page UI). */
  mode: WorkspaceMode | null;
}

const ROOT = path.join(process.cwd(), '.larkup');
const SERVERS_DIR = path.join(ROOT, 'servers');
const WORKSPACE_PATH = path.join(ROOT, 'workspace.json');
const BASE_PORT = 8080;

const EMPTY: Workspace = { username: null, activeServerId: null, servers: [], mode: null };

/* --------------------------- per-request scope --------------------------- */

const als = new AsyncLocalStorage<{ serverId: string }>();

/** Run `fn` with a specific server as the resolved "active" one. */
export function runWithServer<T>(serverId: string, fn: () => T): T {
  return als.run({ serverId }, fn);
}

/* ------------------------------ write mutex ------------------------------ */

let writeChain: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.catch(() => {});
  return run;
}

/* ------------------------------- path utils ------------------------------ */

export function serverDir(id: string) {
  return path.join(SERVERS_DIR, id);
}

/** Posix-relative path to a per-server subdir (used in saved config). */
export function relServerPath(id: string, sub: string) {
  return `./.larkup/servers/${id}/${sub}`;
}

async function exists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function moveIfExists(from: string, to: string) {
  if (!(await exists(from))) return;
  await fs.mkdir(path.dirname(to), { recursive: true });
  try {
    await fs.rename(from, to);
  } catch {
    await fs.cp(from, to, { recursive: true });
    await fs.rm(from, { recursive: true, force: true });
  }
}

/* ------------------------------ workspace io ----------------------------- */

async function readRaw(): Promise<Workspace | null> {
  try {
    const raw = await fs.readFile(WORKSPACE_PATH, 'utf8');
    return { ...EMPTY, ...(JSON.parse(raw) as Partial<Workspace>) };
  } catch {
    return null;
  }
}

async function writeRaw(ws: Workspace): Promise<Workspace> {
  await fs.mkdir(ROOT, { recursive: true });
  await fs.writeFile(WORKSPACE_PATH, JSON.stringify(ws, null, 2), 'utf8');
  return ws;
}

/**
 * Read the workspace, initializing (and migrating legacy single-pipeline data)
 * on first access.
 */
export async function getWorkspace(): Promise<Workspace> {
  const existing = await readRaw();
  if (existing) return existing;
  return serialize(migrateOrInit);
}

/** First-run: fold any legacy root-level pipeline data into a default server. */
async function migrateOrInit(): Promise<Workspace> {
  const again = await readRaw();
  if (again) return again;

  const hasLegacy = await exists(path.join(ROOT, 'config.json'));
  if (!hasLegacy) {
    return writeRaw(EMPTY);
  }

  const id = randomUUID();
  const dir = serverDir(id);
  await fs.mkdir(dir, { recursive: true });

  for (const f of [
    'config.json',
    'documents.json',
    'jobs.json',
    'index-run.json',
    'server-local.json',
  ]) {
    await moveIfExists(path.join(ROOT, f), path.join(dir, f));
  }
  await moveIfExists(path.join(ROOT, 'lancedb'), path.join(dir, 'lancedb'));
  await moveIfExists(path.join(ROOT, 'generated-server'), path.join(dir, 'generated-server'));

  let name = 'Default server';
  try {
    const cfgPath = path.join(dir, 'config.json');
    const cfg = JSON.parse(await fs.readFile(cfgPath, 'utf8')) as RagConfig;
    if (cfg.projectName) name = cfg.projectName;
    if (cfg.vectorStore === 'lancedb' && (cfg.storeConfig?.mode ?? 'local') === 'local') {
      cfg.storeConfig = {
        ...cfg.storeConfig,
        dbPath: relServerPath(id, 'lancedb'),
      };
    }
    await fs.writeFile(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');
  } catch {
    // best effort
  }

  const now = new Date().toISOString();
  const meta: ServerMeta = {
    id,
    name,
    port: BASE_PORT,
    createdAt: now,
    updatedAt: now,
  };
  return writeRaw({ username: null, activeServerId: id, servers: [meta], mode: null });
}

/* ------------------------------ resolution ------------------------------- */

/** The server resolved for the current scope (ALS override → persisted active). */
export async function getActiveServer(): Promise<ServerMeta | null> {
  const ws = await getWorkspace();
  const override = als.getStore()?.serverId;
  const id = override ?? ws.activeServerId;
  if (!id) return null;
  return ws.servers.find((s) => s.id === id) ?? null;
}

export async function getServer(id: string): Promise<ServerMeta | null> {
  const ws = await getWorkspace();
  return ws.servers.find((s) => s.id === id) ?? null;
}

/**
 * Data dir for the resolved server, or null when no server exists yet.
 * Read paths use this and fall back to sensible empty/default values.
 */
export async function getDataDir(): Promise<string | null> {
  const server = await getActiveServer();
  if (!server) return null;
  const dir = serverDir(server.id);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Data dir for the resolved server, creating a default server if the workspace
 * is completely empty. Write paths use this so the app never wedges.
 */
export async function requireDataDir(): Promise<string> {
  const dir = await getDataDir();
  if (dir) return dir;
  const { server } = await createServer('My RAG server');
  return serverDir(server.id);
}

/* -------------------------------- mutations ------------------------------ */

async function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function nextPort(ws: Workspace) {
  const ports = ws.servers.map((s) => s.port);
  let candidate = Math.max(BASE_PORT - 1, ...ports) + 1;
  while (!(await isPortFree(candidate))) {
    candidate++;
  }
  return candidate;
}

function defaultConfigFor(
  id: string,
  name: string,
  prevConfig: Partial<RagConfig> = {},
): RagConfig {
  return {
    ...DEFAULT_CONFIG,
    projectName:
      name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'my-rag',
    storeConfig: { mode: 'local', dbPath: relServerPath(id, 'lancedb') },
    embeddingApiKey: prevConfig.embeddingApiKey ?? DEFAULT_CONFIG.embeddingApiKey,
    customEmbeddings: prevConfig.customEmbeddings ?? DEFAULT_CONFIG.customEmbeddings,
    chatApiKey: prevConfig.chatApiKey ?? DEFAULT_CONFIG.chatApiKey,
    customChatModels: prevConfig.customChatModels ?? DEFAULT_CONFIG.customChatModels,
    serperApiKey: prevConfig.serperApiKey ?? DEFAULT_CONFIG.serperApiKey,
    firecrawlApiKey: prevConfig.firecrawlApiKey ?? DEFAULT_CONFIG.firecrawlApiKey,
    updatedAt: new Date().toISOString(),
  };
}

export function createServer(name: string): Promise<{ workspace: Workspace; server: ServerMeta }> {
  return serialize(async () => {
    const ws = await getWorkspace();
    const id = randomUUID();
    const now = new Date().toISOString();
    const meta: ServerMeta = {
      id,
      name: name.trim() || 'Untitled server',
      port: await nextPort(ws),
      createdAt: now,
      updatedAt: now,
    };
    const dir = serverDir(id);
    await fs.mkdir(dir, { recursive: true });

    let prevConfig: Partial<RagConfig> = {};
    if (ws.activeServerId) {
      try {
        const raw = await fs.readFile(
          path.join(serverDir(ws.activeServerId), 'config.json'),
          'utf8',
        );
        prevConfig = JSON.parse(raw) as Partial<RagConfig>;
      } catch {
        // ignore if not readable
      }
    }

    await fs.writeFile(
      path.join(dir, 'config.json'),
      JSON.stringify(defaultConfigFor(id, meta.name, prevConfig), null, 2),
      'utf8',
    );
    const next: Workspace = {
      ...ws,
      servers: [...ws.servers, meta],
      activeServerId: id,
    };
    await writeRaw(next);
    return { workspace: next, server: meta };
  });
}

export function renameServer(id: string, name: string): Promise<Workspace> {
  return serialize(async () => {
    const ws = await getWorkspace();
    const servers = ws.servers.map((s) =>
      s.id === id ? { ...s, name: name.trim() || s.name, updatedAt: new Date().toISOString() } : s,
    );
    return writeRaw({ ...ws, servers });
  });
}

export function setActiveServer(id: string): Promise<Workspace> {
  return serialize(async () => {
    const ws = await getWorkspace();
    if (!ws.servers.some((s) => s.id === id)) return ws;
    return writeRaw({ ...ws, activeServerId: id });
  });
}

export function setUsername(username: string): Promise<Workspace> {
  return serialize(async () => {
    const ws = await getWorkspace();
    return writeRaw({ ...ws, username: username.trim() || null });
  });
}

export function setMode(mode: WorkspaceMode): Promise<Workspace> {
  return serialize(async () => {
    const ws = await getWorkspace();
    return writeRaw({ ...ws, mode });
  });
}

/**
 * Delete a server and all of its data. Caller is responsible for stopping any
 * running instance first (see the /api/servers route).
 */
export function deleteServer(id: string): Promise<Workspace> {
  return serialize(async () => {
    const ws = await getWorkspace();
    const servers = ws.servers.filter((s) => s.id !== id);
    const activeServerId = ws.activeServerId === id ? servers[0]?.id ?? null : ws.activeServerId;
    await fs.rm(serverDir(id), { recursive: true, force: true });
    return writeRaw({ ...ws, servers, activeServerId });
  });
}
