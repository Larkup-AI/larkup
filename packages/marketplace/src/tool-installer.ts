import { promises as fs } from 'node:fs';
import type { Dirent } from 'node:fs';
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

const installingTools = new Set<string>();
const uninstallingTools = new Set<string>();

export function getOngoingOperations() {
  return {
    installing: Array.from(installingTools),
    uninstalling: Array.from(uninstallingTools),
  };
}

const execAsync = promisify(execCb);

// npm mutates a shared node_modules tree.
let packageMutationChain: Promise<unknown> = Promise.resolve();
function serializePackageMutation<T>(fn: () => Promise<T>): Promise<T> {
  const run = packageMutationChain.then(fn, fn);
  packageMutationChain = run.catch(() => {});
  return run;
}

/**
 * Tool installer — manages installing / uninstalling marketplace tools.
 */

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

export async function getInstalledTools(): Promise<InstalledTool[]> {
  const manifest = await readManifest();
  return [...manifest.tools];
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

/** Known install commands per dependency per platform. */
const INSTALL_HINTS: Record<string, Record<string, string>> = {
  ffmpeg: {
    macos: 'brew install ffmpeg',
    linux_apt: 'sudo apt-get install -y ffmpeg',
    linux_dnf: 'sudo dnf install -y ffmpeg',
    linux_pacman: 'sudo pacman -S --noconfirm ffmpeg',
    linux_apk: 'sudo apk add --no-cache ffmpeg',
  },
};

/**
 * Detect the current platform for install commands.
 */
function detectPlatform(): string {
  if (process.platform === 'darwin') return 'macos';
  return 'linux';
}

async function tryAutoInstallDep(
  dep: string,
  onProgress?: (message: string) => void,
): Promise<boolean> {
  const hints = INSTALL_HINTS[dep];
  if (!hints) return false;

  const platform = detectPlatform();
  let installCmd: string | undefined;

  if (platform === 'macos') {
    // Check if Homebrew is available
    try {
      await execAsync('which brew');
      installCmd = hints.macos;
    } catch {
      // No brew — cannot auto-install on macOS
      return false;
    }
  } else {
    // Linux — detect package manager
    const managers = [
      { cmd: 'apt-get', key: 'linux_apt' },
      { cmd: 'dnf', key: 'linux_dnf' },
      { cmd: 'pacman', key: 'linux_pacman' },
      { cmd: 'apk', key: 'linux_apk' },
    ];
    for (const { cmd, key } of managers) {
      try {
        await execAsync(`which ${cmd}`);
        installCmd = hints[key];
        break;
      } catch {
        // Try next manager
      }
    }
  }

  if (!installCmd) return false;

  onProgress?.(`Auto-installing ${dep} via "${installCmd}"…`);
  try {
    await execAsync(installCmd, { timeout: 300_000 });
    onProgress?.(`${dep} installation command finished.`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    onProgress?.(`Auto-install of ${dep} failed: ${message}`);
    return false;
  }

  // Verify the binary is now available
  try {
    await execAsync(`which ${dep}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Build a user-friendly error message with platform-specific install instructions.
 */
function buildMissingDepsMessage(deps: string[]): string {
  const platform = detectPlatform();
  const lines: string[] = [`Missing system dependencies: ${deps.join(', ')}.`];

  for (const dep of deps) {
    const hints = INSTALL_HINTS[dep];
    if (!hints) {
      lines.push(`  • ${dep}: Please install it manually.`);
      continue;
    }

    if (platform === 'macos' && hints.macos) {
      lines.push(`  • ${dep}: Run \`${hints.macos}\``);
    } else if (platform === 'linux') {
      const linuxHint = hints.linux_apt || hints.linux_dnf || hints.linux_pacman || hints.linux_apk;
      if (linuxHint) {
        lines.push(`  • ${dep}: Run \`${linuxHint}\``);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Check if system dependencies for a tool are available.
 * Returns list of missing dependencies.
 */
export async function checkSystemDeps(toolId: string): Promise<string[]> {
  const descriptor = await getToolById(toolId);
  if (!descriptor?.systemDeps?.length) return [];

  const target = detectDeploymentTarget();

  const missing: string[] = [];
  for (const dep of descriptor.systemDeps) {
    // Video & Audio ships a platform binary via @ffmpeg-installer/ffmpeg.
    if (toolId === 'video-audio' && dep === 'ffmpeg') continue;
    if (target === 'docker' && dep === 'docker') continue;
    try {
      await execAsync(`which ${dep}`);
    } catch {
      missing.push(dep);
    }
  }
  return missing;
}

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
): Promise<{ resolvedPath: string; version: string }> {
  return serializePackageMutation(() =>
    execInstallUnlocked(packageName, version, target, onProgress),
  );
}

async function execInstallUnlocked(
  packageName: string,
  version: string,
  target: DeploymentTarget,
  onProgress?: (message: string) => void,
): Promise<{ resolvedPath: string; version: string }> {
  const toolsDir = getToolsDir();

  switch (target) {
    case 'local':
    case 'docker': {
      // Initialize the isolated tools directory
      await ensureToolsPackageJson();

      const install = async (specifier: string) => {
        const installCmd = `npm install ${specifier} --prefix "${toolsDir}" --save --no-audit --no-fund --prefer-offline`;
        onProgress?.(`Running: npm install ${specifier}`);
        const { stderr } = await execAsync(installCmd, {
          cwd: toolsDir,
          // Native tool dependencies can take longer under Docker Desktop's
          // amd64 emulation. Let the request finish instead of reporting a
          // misleading connection error part way through installation.
          timeout: target === 'docker' ? 300_000 : 120_000,
          env: {
            ...process.env,
            NODE_ENV: 'production',
            // The Docker image runs as an unprivileged user. Keep npm's cache
            // beside the isolated install so a named .larkup volume is always
            // writable and installing a Marketplace tool does not fail before
            // it reaches the registry.
            HOME:
              process.env.HOME && process.env.HOME !== '/nonexistent' ? process.env.HOME : toolsDir,
            npm_config_cache: path.join(toolsDir, '.npm-cache'),
            npm_config_update_notifier: 'false',
          },
        });
        if (stderr && !stderr.includes('npm warn')) {
          console.warn(`[marketplace] Install stderr: ${stderr}`);
        }
      };

      try {
        await install(`${packageName}@${version}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Install command failed';
        if (!message.includes('ETARGET') && !message.includes('No matching version found')) {
          throw new Error(`Failed to install ${packageName}: ${message}`);
        }

        // Hub entries can be cached longer than npm releases. Recover from an
        // obsolete catalog version rather than leaving the marketplace unusable.
        onProgress?.(
          `Catalog version ${version} is unavailable; installing the latest published version…`,
        );
        try {
          await install(`${packageName}@latest`);
        } catch (latestErr) {
          const latestMessage =
            latestErr instanceof Error ? latestErr.message : 'Install command failed';
          throw new Error(`Failed to install ${packageName}: ${latestMessage}`);
        }
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

      const packageJson = JSON.parse(
        await fs.readFile(path.join(resolvedPath, 'package.json'), 'utf8'),
      ) as { version?: string };
      return { resolvedPath, version: packageJson.version ?? version };
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
      return { resolvedPath: path.join(toolsDir, 'node_modules', packageName), version };
    }

    case 'sandbox': {
      // Install into the sandbox's filesystem
      onProgress?.('Installing in sandbox environment');
      await ensureToolsPackageJson();
      const installCmd = `npm install ${packageName}@${version} --prefix "${toolsDir}" --save --no-audit --no-fund`;
      await execAsync(installCmd, { cwd: toolsDir, timeout: 120_000 });
      return { resolvedPath: path.join(toolsDir, 'node_modules', packageName), version };
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
 */
async function isWorkspaceTool(packageName: string): Promise<boolean> {
  return Boolean(await resolveWorkspaceToolPath(packageName));
}

export async function resolveWorkspaceToolPath(packageName: string): Promise<string | undefined> {
  try {
    const linkedPath = path.join(process.cwd(), 'node_modules', ...packageName.split('/'));
    const packageRoot = await fs.realpath(linkedPath);
    const manifest = JSON.parse(
      await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'),
    ) as {
      name?: string;
    };
    return manifest.name === packageName &&
      !packageRoot.includes(`${path.sep}node_modules${path.sep}`)
      ? packageRoot
      : undefined;
  } catch {
    // A newly scaffolded workspace tool may not be linked into root
    // node_modules until the next pnpm install. Resolve it from the workspace
    // package directory so Marketplace development never falls through to npm.
  }

  let workspaceRoot = process.cwd();
  while (true) {
    try {
      await fs.access(path.join(workspaceRoot, 'pnpm-workspace.yaml'));
      break;
    } catch {
      const parent = path.dirname(workspaceRoot);
      if (parent === workspaceRoot) return undefined;
      workspaceRoot = parent;
    }
  }

  const toolsRoot = path.join(workspaceRoot, 'packages', 'marketplace-tools');
  let entries: Dirent[];
  try {
    entries = await fs.readdir(toolsRoot, { withFileTypes: true });
  } catch {
    return undefined;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const packageRoot = path.join(toolsRoot, entry.name);
    try {
      const manifest = JSON.parse(
        await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'),
      ) as { name?: string };
      if (manifest.name === packageName) return packageRoot;
    } catch {
      // Ignore incomplete workspace folders and keep searching.
    }
  }

  return undefined;
}

/**
 * Install a marketplace tool.
 */
export async function installTool(
  toolId: string,
  onProgress?: (progress: InstallProgress) => void,
  initialConfig: Record<string, unknown> = {},
): Promise<void> {
  installingTools.add(toolId);
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
    let missing = (await checkSystemDeps(toolId)).filter((dependency) => dependency !== 'docker');

    // 2a. Attempt auto-install for known dependencies
    if (missing.length > 0) {
      const stillMissing: string[] = [];
      for (const dep of missing) {
        report('checking-deps', 18, `Attempting to install ${dep}…`);
        const installed = await tryAutoInstallDep(dep, (msg) => report('checking-deps', 20, msg));
        if (installed) {
          report('checking-deps', 22, `${dep} installed successfully.`);
        } else {
          stillMissing.push(dep);
        }
      }
      missing = stillMissing;
    }

    if (missing.length > 0) {
      const msg = buildMissingDepsMessage(missing);
      report('failed', 0, msg);
      throw new Error(msg);
    }

    // 3. Determine install strategy
    const isWorkspace = await isWorkspaceTool(descriptor.packageName);
    const target = detectDeploymentTarget();
    let resolvedPath: string;
    let installedVersion = descriptor.version;
    let source: ToolSource;

    if (isWorkspace) {
      // Monorepo development — tool is already linked via workspace
      report('downloading', 30, 'Resolving workspace package…');
      resolvedPath =
        (await resolveWorkspaceToolPath(descriptor.packageName)) ??
        path.join(process.cwd(), 'node_modules', descriptor.packageName);
      source = 'local';
      report('installing', 60, 'Workspace package resolved.');
    } else {
      // Remote install — download from npm into isolated directory
      report('downloading', 30, `Downloading ${descriptor.packageName}@${descriptor.version}…`);
      const installed = await execInstall(
        descriptor.packageName,
        descriptor.version,
        target,
        (msg) => report('downloading', 50, msg),
      );
      resolvedPath = installed.resolvedPath;
      installedVersion = installed.version;
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
      version: installedVersion,
      installedAt: new Date().toISOString(),
      packageName: descriptor.packageName,
      resolvedPath,
      source,
      config: { ...buildDefaultConfig(descriptor), ...initialConfig },
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
  } finally {
    installingTools.delete(toolId);
  }
}

export async function uninstallTool(toolId: string): Promise<void> {
  uninstallingTools.add(toolId);
  try {
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
    const { unloadTool } = await import('./tool-loader');
    unloadTool(toolId);
  } finally {
    uninstallingTools.delete(toolId);
  }
}

export async function updateToolConfig(toolId: string, config: Record<string, any>): Promise<void> {
  const manifest = await readManifest();
  const tool = manifest.tools.find((t) => t.id === toolId);
  if (!tool) throw new Error(`Tool ${toolId} is not installed.`);
  tool.config = { ...tool.config, ...config };
  await writeManifest(manifest);
}

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
