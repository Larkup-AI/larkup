import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn, exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { RagConfig } from '../types';
import { generateServer, type GeneratedFile } from './generate-server';
import { resolveChatModel } from './chat-module';
import { getActiveProject, getProjectDataDir, requireProjectDataDir } from '../project-store';
import { readEnabledMcpConnectionsForAgent } from '../mcp-store';

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
  const project = await getActiveProject();
  return project?.port ?? FALLBACK_PORT;
}

function emptyState(port: number): LocalServerState {
  return {
    running: false,
    port,
    endpoint: `http://localhost:${port}`,
  };
}

async function outDir(create: boolean): Promise<string | null> {
  const dir = create ? await requireProjectDataDir() : await getProjectDataDir();
  if (!dir) return null;
  return path.join(dir, 'generated-server');
}

async function statePath(create: boolean): Promise<string | null> {
  const dir = create ? await requireProjectDataDir() : await getProjectDataDir();
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

type InstalledPlugin = {
  id?: string;
  name?: string;
  packageName?: string;
  version?: string;
  source?: 'registry' | 'local' | 'sandbox';
  resolvedPath?: string;
  config?: Record<string, unknown>;
};

type AgentPluginRuntime = Required<Pick<RagConfig, 'agentPlugins'>>['agentPlugins'][number] & {
  config: Record<string, unknown>;
  source?: InstalledPlugin['source'];
  resolvedPath?: string;
};

const PACKAGE_NAME = /^(?:@[-a-z0-9~][-_a-z0-9~]*\/)?[-a-z0-9~][-_a-z0-9~]*$/i;
const PLUGIN_ID = /^[-a-z0-9]+$/i;

/**
 * Local workspace links are useful while developing an Agent, but their
 * absolute paths do not exist in a generated remote runtime. Portable
 * artifacts bundle the package below `marketplace-tools/` instead.
 */
export function resolveRuntimePluginVersion(
  plugin: Pick<InstalledPlugin, 'id' | 'source' | 'resolvedPath' | 'version'>,
  portable = false,
): string | undefined {
  if (
    portable &&
    plugin.source === 'local' &&
    typeof plugin.id === 'string' &&
    PLUGIN_ID.test(plugin.id)
  ) {
    return `file:./marketplace-tools/${plugin.id}`;
  }
  if (
    !portable &&
    plugin.source === 'local' &&
    typeof plugin.resolvedPath === 'string' &&
    path.isAbsolute(plugin.resolvedPath)
  ) {
    return `file:${plugin.resolvedPath}`;
  }
  return plugin.version;
}

async function loadEnabledPlugins(
  config: RagConfig,
  portable = false,
): Promise<AgentPluginRuntime[]> {
  if (config.runtimeProfile !== 'assistant') return [];
  try {
    const raw = await fs.readFile(
      path.join(process.cwd(), '.larkup', 'tools', 'installed.json'),
      'utf8',
    );
    const parsed = JSON.parse(raw) as { tools?: InstalledPlugin[] };
    const enabled = new Set(config.enabledTools ?? []);
    const installed = (parsed.tools ?? []).filter(
      (plugin) =>
        typeof plugin.id === 'string' &&
        typeof plugin.packageName === 'string' &&
        typeof plugin.version === 'string' &&
        PACKAGE_NAME.test(plugin.packageName) &&
        (enabled.size === 0 || enabled.has(plugin.id)),
    );
    return installed.map((plugin) => ({
      id: plugin.id!,
      packageName: plugin.packageName!,
      version: resolveRuntimePluginVersion(plugin, portable)!,
      config: plugin.config ?? {},
      source: plugin.source,
      resolvedPath: plugin.resolvedPath,
    }));
  } catch {
    return [];
  }
}

type PackageManifest = Record<string, unknown> & {
  name?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

async function publishedWorkspaceVersion(packageName: string): Promise<string | undefined> {
  try {
    const packageJson = JSON.parse(
      await fs.readFile(
        path.join(process.cwd(), 'node_modules', ...packageName.split('/'), 'package.json'),
        'utf8',
      ),
    ) as { version?: unknown };
    return typeof packageJson.version === 'string' ? packageJson.version : undefined;
  } catch {
    return undefined;
  }
}

async function replaceWorkspaceDependencyVersions(manifest: PackageManifest) {
  for (const key of ['dependencies', 'optionalDependencies', 'peerDependencies'] as const) {
    const dependencies = manifest[key];
    if (!dependencies) continue;
    for (const [packageName, requestedVersion] of Object.entries(dependencies)) {
      if (!requestedVersion.startsWith('workspace:')) continue;
      const workspaceVersion = await publishedWorkspaceVersion(packageName);
      if (!workspaceVersion) {
        throw new Error(
          `Could not resolve a publishable version for workspace dependency ${packageName}.`,
        );
      }
      const requestedRange = requestedVersion.slice('workspace:'.length);
      dependencies[packageName] =
        requestedRange === '*' || requestedRange === '^' || requestedRange === '~'
          ? `${requestedRange === '*' ? '^' : requestedRange}${workspaceVersion}`
          : requestedRange;
    }
  }
}

function encodedPluginFile(pathname: string, contents: Buffer): GeneratedFile {
  const textFile = /\.(?:[cm]?js|json|d\.ts)$/i.test(pathname);
  return textFile
    ? { path: pathname, contents: contents.toString('utf8'), language: 'javascript' }
    : {
        path: pathname,
        contents: contents.toString('base64'),
        language: 'text',
        encoding: 'base64',
      };
}

async function addBuiltPluginFiles(
  packageRoot: string,
  relativePath: string,
  outputRoot: string,
  files: GeneratedFile[],
): Promise<void> {
  const directory = path.join(packageRoot, relativePath);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const nextRelativePath = path.join(relativePath, entry.name);
    if (entry.isDirectory()) {
      await addBuiltPluginFiles(packageRoot, nextRelativePath, outputRoot, files);
    } else if (entry.isFile()) {
      const generatedPath = path.posix.join(outputRoot, ...nextRelativePath.split(path.sep));
      files.push(
        encodedPluginFile(
          generatedPath,
          await fs.readFile(path.join(packageRoot, nextRelativePath)),
        ),
      );
    }
  }
}

/** Bundle an enabled workspace Marketplace tool into a portable Agent artifact. */
export async function bundleWorkspaceMarketplacePlugin(
  plugin: Pick<InstalledPlugin, 'id' | 'packageName' | 'source' | 'resolvedPath'>,
): Promise<GeneratedFile[]> {
  if (
    plugin.source !== 'local' ||
    typeof plugin.id !== 'string' ||
    !PLUGIN_ID.test(plugin.id) ||
    typeof plugin.packageName !== 'string' ||
    typeof plugin.resolvedPath !== 'string' ||
    !path.isAbsolute(plugin.resolvedPath)
  ) {
    return [];
  }

  const packageRoot = await fs.realpath(plugin.resolvedPath);
  const packageJson = JSON.parse(
    await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'),
  ) as PackageManifest;
  if (packageJson.name !== plugin.packageName) {
    throw new Error(
      `Could not bundle Marketplace tool ${plugin.id}: package metadata does not match.`,
    );
  }
  await fs.access(path.join(packageRoot, 'dist'));
  await replaceWorkspaceDependencyVersions(packageJson);
  delete packageJson.devDependencies;

  const outputRoot = path.posix.join('marketplace-tools', plugin.id);
  const files: GeneratedFile[] = [
    {
      path: path.posix.join(outputRoot, 'package.json'),
      contents: JSON.stringify(packageJson, null, 2) + '\n',
      language: 'json',
    },
  ];
  await addBuiltPluginFiles(packageRoot, 'dist', outputRoot, files);
  return files;
}

async function hydrateRemoteSkills(config: RagConfig): Promise<RagConfig['skills']> {
  return Promise.all(
    (config.skills ?? []).map(async (skill) => {
      if (skill.enabled === false || skill.source !== 'remote' || !skill.url || skill.content)
        return skill;
      try {
        const url = new URL(skill.url);
        if (url.protocol !== 'https:') return skill;
        const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
        if (!response.ok) return skill;
        const content = (await response.text()).slice(0, 12_000);
        return content ? { ...skill, content } : skill;
      } catch {
        return skill;
      }
    }),
  );
}

export interface AgentRuntimeSelection {
  /** MCP connections selected for this runtime. Omit to use every enabled connection. */
  mcpConnectionIds?: string[];
  /** Remote artifacts bundle locally linked Marketplace tools. */
  portable?: boolean;
}

/**
 * Resolve the portable Agent configuration and the sensitive runtime-only
 * environment values needed by a local or remote generated server.
 */
export async function prepareAgentRuntime(
  config: RagConfig,
  selection: AgentRuntimeSelection = {},
) {
  if (config.runtimeProfile !== 'assistant') {
    return { config, env: {} as Record<string, string>, pluginFiles: [] as GeneratedFile[] };
  }
  const [skills, allMcpConnections, agentPlugins] = await Promise.all([
    hydrateRemoteSkills(config),
    readEnabledMcpConnectionsForAgent(),
    loadEnabledPlugins(config, selection.portable),
  ]);
  const pluginFiles = selection.portable
    ? (
        await Promise.all(agentPlugins.map((plugin) => bundleWorkspaceMarketplacePlugin(plugin)))
      ).flat()
    : [];
  const configuredPlugins = (config.agentPlugins ?? [])
    .filter(
      (plugin) =>
        typeof plugin.id === 'string' &&
        typeof plugin.packageName === 'string' &&
        ((config.enabledTools ?? []).length === 0 ||
          (config.enabledTools ?? []).includes(plugin.id)),
    )
    .map((plugin) => ({ ...plugin, config: {} as Record<string, unknown> }));
  const pluginsById = new Map(configuredPlugins.map((plugin) => [plugin.id, plugin]));
  for (const plugin of agentPlugins) {
    pluginsById.set(plugin.id, { ...pluginsById.get(plugin.id), ...plugin });
  }
  const resolvedPlugins = [...pluginsById.values()];
  const selectedMcpIds = selection.mcpConnectionIds ? new Set(selection.mcpConnectionIds) : null;
  const mcpConnections = selectedMcpIds
    ? allMcpConnections.filter((connection) => selectedMcpIds.has(connection.id))
    : allMcpConnections;
  const sandboxBackend = config.defaultSandboxProvider || 'local';
  return {
    config: {
      ...config,
      skills,
      agentPlugins: resolvedPlugins.map(({ id, name, packageName, version }) => ({
        id,
        name,
        packageName,
        version,
      })),
    },
    env: {
      LARKUP_MCP_CONNECTIONS: JSON.stringify(mcpConnections),
      LARKUP_SANDBOX_BACKEND: sandboxBackend,
      LARKUP_SANDBOX_CREDENTIALS: JSON.stringify(
        config.sandboxProviderConfigs?.[sandboxBackend] ?? {},
      ),
      LARKUP_AGENT_PLUGIN_MODULES: JSON.stringify(
        resolvedPlugins.map(({ id, name, packageName, config: pluginConfig }) => ({
          id,
          name,
          packageName,
          config: pluginConfig,
        })),
      ),
    },
    pluginFiles,
  };
}

/** Write the generated server files to disk (always refreshes the output). */
export async function emitToDisk(config: RagConfig): Promise<string> {
  const server = generateServer(config);
  const dir = await outDir(true);
  if (!dir) throw new Error('No active Project to emit to.');
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

/** Local launches use the workspace sandbox build so they include unreleased provider fixes. */
async function linkWorkspaceSandbox(dir: string): Promise<void> {
  const sandboxDir = path.join(process.cwd(), 'packages', 'sandbox');
  try {
    await fs.access(path.join(sandboxDir, 'package.json'));
    await fs.access(path.join(sandboxDir, 'dist', 'index.js'));
    const packageFile = path.join(dir, 'package.json');
    const generatedPackage = JSON.parse(await fs.readFile(packageFile, 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    if (!generatedPackage.dependencies?.['@larkup/sandbox']) return;
    generatedPackage.dependencies['@larkup/sandbox'] = `file:${sandboxDir}`;
    await fs.writeFile(packageFile, JSON.stringify(generatedPackage, null, 2) + '\n', 'utf8');
  } catch {
    // A distributed CLI has no workspace package; it uses the published dependency.
  }
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
 * Install a generated server's dependencies without retaining npm's download
 * cache in the durable workspace volume. The installed node_modules directory
 * is kept for the running server; the cache is only an install by-product and
 * can otherwise grow on every restart or be left corrupt after an ENOSPC error.
 */
async function installGeneratedServerDependencies(dir: string): Promise<void> {
  const cacheDir = path.join(dir, '.npm-cache');

  // Clear a partial cache from an interrupted install before npm reads it.
  await fs.rm(cacheDir, { recursive: true, force: true }).catch(() => {});

  try {
    await execAsync('npm install --omit=dev --no-audit --no-fund', {
      cwd: dir,
      timeout: 240_000,
      env: {
        ...process.env,
        HOME: process.env.HOME || dir,
        npm_config_cache: cacheDir,
      },
    });
  } finally {
    // node_modules is the runtime dependency tree. The cache is disposable.
    await fs.rm(cacheDir, { recursive: true, force: true }).catch(() => {});
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

  // A Project's configured database path is already scoped to that Project.
  // Preserve its table name so the local runtime queries the same index as the UI.
  const prepared = await prepareAgentRuntime(config);
  const runtimeConfig = prepared.config;
  const dir = await emitToDisk(runtimeConfig);
  await linkWorkspaceSandbox(dir);

  // Install minimal deps (idempotent) without growing the persisted workspace.
  try {
    await installGeneratedServerDependencies(dir);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'npm install failed';
    return writeState({ ...emptyState(port), lastError: message });
  }

  const dbPath = runtimeConfig.storeConfig.dbPath || './.larkup/lancedb';
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
      TOP_K: String(runtimeConfig.topK),
      SERVER_API_KEY: serverApiKey || '',
      EMBEDDING_API_KEY:
        runtimeConfig.embeddingApiKey ||
        process.env.EMBEDDING_API_KEY ||
        process.env.OPENAI_API_KEY ||
        '',
      CHAT_API_KEY:
        runtimeConfig.chatApiKey ||
        runtimeConfig.customChatModels?.find(
          (model) => model.modelName === runtimeConfig.chatModelId?.replace(/^custom:/, ''),
        )?.apiKey ||
        process.env.CHAT_API_KEY ||
        process.env.OPENAI_API_KEY ||
        '',
      CHAT_MODEL: process.env.CHAT_MODEL || resolveChatModel(runtimeConfig),
      CHAT_BASE_URL:
        runtimeConfig.customChatModels?.find(
          (model) => model.modelName === runtimeConfig.chatModelId?.replace(/^custom:/, ''),
        )?.baseUrl ||
        process.env.CHAT_BASE_URL ||
        '',
      OPENAI_API_KEY:
        runtimeConfig.embeddingApiKey ||
        runtimeConfig.chatApiKey ||
        process.env.OPENAI_API_KEY ||
        '',
      ANTHROPIC_API_KEY:
        runtimeConfig.chatApiKey ||
        runtimeConfig.embeddingApiKey ||
        process.env.ANTHROPIC_API_KEY ||
        '',
      COHERE_API_KEY:
        runtimeConfig.embeddingApiKey ||
        runtimeConfig.chatApiKey ||
        process.env.COHERE_API_KEY ||
        '',
      GOOGLE_GENERATIVE_AI_API_KEY:
        runtimeConfig.embeddingApiKey ||
        runtimeConfig.chatApiKey ||
        process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
        '',
      PINECONE_API_KEY: runtimeConfig.storeConfig.apiKey || '',
      PINECONE_INDEX: runtimeConfig.storeConfig.indexName || '',
      PINECONE_NAMESPACE: runtimeConfig.storeConfig.namespace || '',
      PINECONE_SPARSE_MODEL: runtimeConfig.storeConfig.sparseModel || '',
      PINECONE_SPARSE_INDEX: runtimeConfig.storeConfig.sparseIndexName || '',
      LANCEDB_MODE: runtimeConfig.storeConfig.mode || 'local',
      LANCEDB_PATH: absDb,
      LANCEDB_URI: runtimeConfig.storeConfig.uri || '',
      LANCEDB_API_KEY: runtimeConfig.storeConfig.apiKey || '',
      LANCEDB_S3_URI: runtimeConfig.storeConfig.s3Uri || '',
      AWS_ENDPOINT: runtimeConfig.storeConfig.s3Endpoint || '',
      AWS_REGION: runtimeConfig.storeConfig.s3Region || '',
      AWS_ACCESS_KEY_ID: runtimeConfig.storeConfig.s3AccessKeyId || '',
      AWS_SECRET_ACCESS_KEY: runtimeConfig.storeConfig.s3SecretAccessKey || '',
      LANCEDB_TABLE: runtimeConfig.storeConfig.tableName || 'documents',
      ...prepared.env,
    },
  });

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
        const lastLines = trimmed.split('\n').slice(-20).join('\n');
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
