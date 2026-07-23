import { promises as fs } from 'node:fs';
import path from 'node:path';
import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  InstalledTool,
  InstalledToolsManifest,
  InstallProgress,
  ToolDescriptor,
  DeploymentTarget,
  ToolSource,
} from './types';
import { getToolById, invalidateRegistryCache } from './tool-registry';

const execAsync = promisify(execCb);

/**
 * Tool installer — manages installing / uninstalling marketplace tools.
 *
 * Architecture:
 * ─────────────────────────────────────────────────────────────────────
 * Tools are installed into an ISOLATED directory:
 *   `.larkup/tools/node_modules/@larkup/tool-*`
 *
 * This design:
 * - Keeps the user's project package.json clean (no pollution)
 * - Makes tools portable — copy `.larkup/tools/` to any machine
 * - Enables per-agent tool sets (future: each agent has its own tools dir)
 * - Works identically across local, Docker, and sandbox deployments
 *
 * The installer tracks state in `.larkup/tools/installed.json`.
 * The loader resolves modules from the isolated node_modules.
 * ─────────────────────────────────────────────────────────────────────
 */

/* ------------------------------------------------------------------ */
/* Paths                                                               */
/* ------------------------------------------------------------------ */

/** Root directory for tool installations. */
function getToolsDir(): string {
  return path.join(process.cwd(), '.larkup', 'tools');
}

/** Path to the installed tools manifest. */
function getManifestPath(): string {
  return path.join(getToolsDir(), 'installed.json');
}

/** Path to the isolated node_modules for tools. */
export function getToolsNodeModulesDir(): string {
  return path.join(getToolsDir(), 'node_modules');
}

/* ------------------------------------------------------------------ */
/* Manifest persistence                                                */
/* ------------------------------------------------------------------ */

async function ensureDir() {
  await fs.mkdir(getToolsDir(), { recursive: true });
}

async function readManifest(): Promise<InstalledToolsManifest> {
  try {
    const raw = await fs.readFile(getManifestPath(), 'utf8');
    const parsed = JSON.parse(raw);
    // Migrate old manifests without downloadCounts
    if (!parsed.downloadCounts) parsed.downloadCounts = {};
    // Migrate old manifests: packagePath → packageName
    for (const tool of parsed.tools ?? []) {
      if (tool.packagePath && !tool.packageName) {
        tool.packageName = tool.packagePath;
        delete tool.packagePath;
      }
      if (!tool.source) tool.source = 'local';
      if (!tool.resolvedPath) {
        tool.resolvedPath = tool.packageName;
      }
    }
    return parsed;
  } catch {
    return { tools: [], downloadCounts: {}, updatedAt: new Date().toISOString() };
  }
}

async function writeManifest(manifest: InstalledToolsManifest) {
  await ensureDir();
  manifest.updatedAt = new Date().toISOString();
  await fs.writeFile(getManifestPath(), JSON.stringify(manifest, null, 2), 'utf8');
}

/* ------------------------------------------------------------------ */
/* Public query API                                                    */
/* ------------------------------------------------------------------ */

export async function getInstalledTools(): Promise<InstalledTool[]> {
  const manifest = await readManifest();
  const tools = [...manifest.tools];
  const bundledIds = (process.env.LARKUP_BUNDLED_TOOLS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  for (const toolId of bundledIds) {
    if (tools.some((tool) => tool.id === toolId)) continue;
    const descriptor = await getToolById(toolId);
    if (!descriptor) continue;
    tools.push({
      id: toolId,
      version: descriptor.version,
      installedAt: 'bundled',
      packageName: descriptor.packageName,
      resolvedPath: descriptor.packageName,
      source: 'local',
      config: buildDefaultConfig(descriptor),
    });
  }

  return tools;
}

export async function isToolInstalled(toolId: string): Promise<boolean> {
  const tools = await getInstalledTools();
  return tools.some((t) => t.id === toolId);
}

export async function getInstalledTool(toolId: string): Promise<InstalledTool | undefined> {
  const tools = await getInstalledTools();
  return tools.find((t) => t.id === toolId);
}

/** Get download counts for all tools. */
export async function getDownloadCounts(): Promise<Record<string, number>> {
  const manifest = await readManifest();
  return manifest.downloadCounts;
}

/* ------------------------------------------------------------------ */
/* System dependency checks                                            */
/* ------------------------------------------------------------------ */

/**
 * Check if system dependencies for a tool are available.
 * Returns list of missing dependencies.
 */
export async function checkSystemDeps(toolId: string): Promise<string[]> {
  const descriptor = await getToolById(toolId);
  if (!descriptor?.systemDeps?.length) return [];

  const missing: string[] = [];
  for (const dep of descriptor.systemDeps) {
    try {
      await execAsync(`which ${dep}`);
    } catch {
      missing.push(dep);
    }
  }
  return missing;
}

/* ------------------------------------------------------------------ */
/* Install execution — the core logic                                  */
/* ------------------------------------------------------------------ */

/**
 * Detect the current deployment target from environment.
 */
function detectDeploymentTarget(): DeploymentTarget {
  // Explicit override
  const explicit = process.env.LARKUP_DEPLOYMENT_TARGET;
  if (explicit && ['local', 'docker', 'serverless', 'sandbox'].includes(explicit)) {
    return explicit as DeploymentTarget;
  }

  // Auto-detect
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) return 'serverless';
  if (process.env.DOCKER_CONTAINER || isDockerEnvironment()) return 'docker';
  if (process.env.E2B_SANDBOX_ID || process.env.MODAL_TASK_ID) return 'sandbox';

  return 'local';
}

function isDockerEnvironment(): boolean {
  try {
    const fs = require('node:fs');
    return fs.existsSync('/.dockerenv');
  } catch {
    return false;
  }
}

/**
 * Initialize the isolated tools directory with a package.json.
 * This is needed for `npm install --prefix` to work correctly.
 */
async function ensureToolsPackageJson(): Promise<void> {
  const toolsDir = getToolsDir();
  const pkgPath = path.join(toolsDir, 'package.json');

  try {
    await fs.access(pkgPath);
  } catch {
    await ensureDir();
    await fs.writeFile(
      pkgPath,
      JSON.stringify(
        {
          name: 'larkup-tools',
          version: '1.0.0',
          private: true,
          description: 'Isolated directory for installed Larkup marketplace tools.',
        },
        null,
        2,
      ),
      'utf8',
    );
  }
}

/**
 * Execute the actual package install into the isolated tools directory.
 */
async function execInstall(
  packageName: string,
  version: string,
  target: DeploymentTarget,
  onProgress?: (message: string) => void,
): Promise<string> {
  const toolsDir = getToolsDir();

  switch (target) {
    case 'local':
    case 'docker': {
      // Initialize the isolated tools directory
      await ensureToolsPackageJson();

      const installCmd = `npm install ${packageName}@${version} --prefix "${toolsDir}" --save --no-audit --no-fund`;
      onProgress?.(`Running: npm install ${packageName}@${version}`);

      try {
        const { stdout, stderr } = await execAsync(installCmd, {
          cwd: toolsDir,
          timeout: 120_000, // 2 minute timeout
          env: { ...process.env, NODE_ENV: 'production' },
        });

        if (stderr && !stderr.includes('npm warn')) {
          console.warn(`[marketplace] Install stderr: ${stderr}`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Install command failed';
        throw new Error(`Failed to install ${packageName}: ${message}`);
      }

      // Resolve the actual module path
      const resolvedPath = path.join(toolsDir, 'node_modules', packageName);
      try {
        await fs.access(resolvedPath);
      } catch {
        throw new Error(
          `Package ${packageName} was installed but could not be found at ${resolvedPath}`,
        );
      }

      return resolvedPath;
    }

    case 'serverless': {
      // Cannot install at runtime on serverless — queue for next deploy
      onProgress?.('Serverless environment detected — queuing for next deploy');
      const pendingPath = path.join(toolsDir, 'pending-tools.json');
      let pending: { tools: { packageName: string; version: string }[] } = { tools: [] };
      try {
        const raw = await fs.readFile(pendingPath, 'utf8');
        pending = JSON.parse(raw);
      } catch {
        // No pending file yet
      }
      pending.tools.push({ packageName, version });
      await ensureDir();
      await fs.writeFile(pendingPath, JSON.stringify(pending, null, 2), 'utf8');

      // Return the expected path (will be available after redeploy)
      return path.join(toolsDir, 'node_modules', packageName);
    }

    case 'sandbox': {
      // Install into the sandbox's filesystem
      onProgress?.('Installing in sandbox environment');
      await ensureToolsPackageJson();
      const installCmd = `npm install ${packageName}@${version} --prefix "${toolsDir}" --save --no-audit --no-fund`;
      await execAsync(installCmd, { cwd: toolsDir, timeout: 120_000 });
      return path.join(toolsDir, 'node_modules', packageName);
    }

    default:
      throw new Error(`Unsupported deployment target: ${target}`);
  }
}

/**
 * Resolve a tool's manifest from the registry or Hub API.
 */
async function resolveManifest(toolId: string): Promise<ToolDescriptor> {
  const descriptor = await getToolById(toolId);
  if (descriptor) return descriptor;
  throw new Error(`Unknown tool: ${toolId}. Not found in local registry or Hub.`);
}

/**
 * Determine the install source based on the environment.
 * In the monorepo (development), tools are already available as workspace packages.
 * Outside the monorepo, tools are downloaded from npm.
 */
async function isWorkspaceTool(packageName: string): Promise<boolean> {
  try {
    // Check if this package exists in the pnpm workspace
    const { stdout } = await execAsync(`pnpm ls -r --depth -1 --json 2>/dev/null || true`, {
      cwd: process.cwd(),
      timeout: 10_000,
    });
    const data = JSON.parse(stdout || '[]');
    return Array.isArray(data) && data.some((pkg: any) => pkg.name === packageName);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Install / uninstall public API                                      */
/* ------------------------------------------------------------------ */

/**
 * Install a marketplace tool.
 *
 * The install process:
 * 1. Resolve the tool manifest (local → Hub → fallback)
 * 2. Check system dependencies (ffmpeg, docker, etc.)
 * 3. Determine install strategy:
 *    - Workspace tool (monorepo dev)? → resolve path, no download needed
 *    - Remote tool? → `npm install` into `.larkup/tools/node_modules/`
 * 4. Record in `installed.json`
 * 5. Notify Hub API (fire-and-forget install counter)
 * 6. Refresh registry cache
 */
export async function installTool(
  toolId: string,
  onProgress?: (progress: InstallProgress) => void,
): Promise<void> {
  const report = (stage: InstallProgress['stage'], percent: number, message: string) => {
    onProgress?.({ toolId, stage, percent, message });
  };

  try {
    // 1. Resolve manifest
    report('checking-deps', 5, 'Resolving tool manifest…');
    const descriptor = await resolveManifest(toolId);

    if (descriptor.comingSoon) {
      throw new Error(`${descriptor.name} is coming soon.`);
    }

    // 2. Check system dependencies
    report('checking-deps', 15, 'Checking system dependencies…');
    const missing = await checkSystemDeps(toolId);
    if (missing.length > 0) {
      const msg = `Missing system dependencies: ${missing.join(', ')}. Please install them first.`;
      report('failed', 0, msg);
      throw new Error(msg);
    }

    // 3. Determine install strategy
    const isWorkspace = await isWorkspaceTool(descriptor.packageName);
    const target = detectDeploymentTarget();
    let resolvedPath: string;
    let source: ToolSource;

    if (isWorkspace) {
      // Monorepo development — tool is already linked via workspace
      report('downloading', 30, 'Resolving workspace package…');
      try {
        // Resolve the workspace package path
        const modulePath = require.resolve(descriptor.packageName, {
          paths: [process.cwd()],
        });
        resolvedPath = path.dirname(modulePath);
      } catch {
        // Fallback: try resolving from node_modules directly
        resolvedPath = path.join(process.cwd(), 'node_modules', descriptor.packageName);
      }
      source = 'local';
      report('installing', 60, 'Workspace package resolved.');
    } else {
      // Remote install — download from npm into isolated directory
      report('downloading', 30, `Downloading ${descriptor.packageName}@${descriptor.version}…`);
      resolvedPath = await execInstall(descriptor.packageName, descriptor.version, target, (msg) =>
        report('downloading', 50, msg),
      );
      source = target === 'sandbox' ? 'sandbox' : 'registry';
      report('installing', 70, 'Package installed.');
    }

    // 4. Record in manifest
    report('installing', 80, 'Registering tool…');
    await ensureDir();
    const manifest = await readManifest();
    const existing = manifest.tools.findIndex((t) => t.id === toolId);

    const entry: InstalledTool = {
      id: toolId,
      version: descriptor.version,
      installedAt: new Date().toISOString(),
      packageName: descriptor.packageName,
      resolvedPath,
      source,
      config: buildDefaultConfig(descriptor),
    };

    if (existing >= 0) {
      manifest.tools[existing] = entry;
    } else {
      manifest.tools.push(entry);
    }

    // Track download count
    manifest.downloadCounts[toolId] = (manifest.downloadCounts[toolId] ?? 0) + 1;

    await writeManifest(manifest);

    // 5. Notify Hub (fire-and-forget)
    notifyHubInstall(toolId).catch(() => {});

    // 6. Refresh registry cache (new tool manifests may be discoverable)
    invalidateRegistryCache();

    // Done
    report('completed', 100, 'Installed successfully.');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Installation failed.';
    report('failed', 0, message);
    throw err;
  }
}

export async function uninstallTool(toolId: string): Promise<void> {
  const manifest = await readManifest();
  const tool = manifest.tools.find((t) => t.id === toolId);

  // Remove from manifest
  manifest.tools = manifest.tools.filter((t) => t.id !== toolId);
  await writeManifest(manifest);

  // If it was installed from npm, remove from isolated node_modules
  if (tool?.source === 'registry' && tool.packageName) {
    try {
      const toolsDir = getToolsDir();
      await execAsync(`npm uninstall ${tool.packageName} --prefix "${toolsDir}"`, {
        cwd: toolsDir,
        timeout: 30_000,
      });
    } catch {
      // Best-effort cleanup
    }
  }

  // Refresh registry cache
  invalidateRegistryCache();
}

export async function updateToolConfig(toolId: string, config: Record<string, any>): Promise<void> {
  const manifest = await readManifest();
  const tool = manifest.tools.find((t) => t.id === toolId);
  if (!tool) throw new Error(`Tool ${toolId} is not installed.`);
  tool.config = { ...tool.config, ...config };
  await writeManifest(manifest);
}

/* ------------------------------------------------------------------ */
/* Hub notification                                                    */
/* ------------------------------------------------------------------ */

/**
 * Notify the Hub API that a tool was installed (increment counter).
 * This is fire-and-forget — never blocks the install flow.
 */
async function notifyHubInstall(toolId: string): Promise<void> {
  const hubUrl = process.env.LARKUP_HUB_URL ?? 'https://hub.larkup.de';
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    await fetch(`${hubUrl}/v1/tools/${toolId}/installed`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
    });
    clearTimeout(timeout);
  } catch {
    // Silently fail — not critical
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function buildDefaultConfig(descriptor: {
  configSchema?: { key: string; defaultValue?: string }[];
}): Record<string, any> {
  const config: Record<string, any> = {};
  for (const field of descriptor.configSchema ?? []) {
    if (field.defaultValue !== undefined) {
      config[field.key] = field.defaultValue;
    }
  }
  return config;
}
