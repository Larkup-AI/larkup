import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { InstalledTool, InstalledToolsManifest, InstallProgress } from './types';
import { getToolById } from './tool-registry';

/**
 * Tool installer — manages installing / uninstalling marketplace tools.
 *
 * Tools are workspace-scoped npm packages installed into `.larkup/tools/`.
 * The installer tracks state in `.larkup/tools/installed.json`.
 *
 * In the future, install can pull from a remote Hub API. For now the
 * packages live in the monorepo under `packages/tools/`.
 */

const TOOLS_DIR = path.join(process.cwd(), '.larkup', 'tools');
const MANIFEST_PATH = path.join(TOOLS_DIR, 'installed.json');

/* ------------------------------------------------------------------ */
/* Manifest persistence                                                */
/* ------------------------------------------------------------------ */

async function ensureDir() {
  await fs.mkdir(TOOLS_DIR, { recursive: true });
}

async function readManifest(): Promise<InstalledToolsManifest> {
  try {
    const raw = await fs.readFile(MANIFEST_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    // Migrate old manifests without downloadCounts
    if (!parsed.downloadCounts) parsed.downloadCounts = {};
    return parsed;
  } catch {
    return { tools: [], downloadCounts: {}, updatedAt: new Date().toISOString() };
  }
}

async function writeManifest(manifest: InstalledToolsManifest) {
  await ensureDir();
  manifest.updatedAt = new Date().toISOString();
  await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export async function getInstalledTools(): Promise<InstalledTool[]> {
  const manifest = await readManifest();
  return manifest.tools;
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

/**
 * Check if system dependencies for a tool are available.
 * Returns list of missing dependencies.
 */
export async function checkSystemDeps(toolId: string): Promise<string[]> {
  const descriptor = getToolById(toolId);
  if (!descriptor?.systemDeps?.length) return [];

  const missing: string[] = [];
  for (const dep of descriptor.systemDeps) {
    try {
      const { execSync } = await import('node:child_process');
      execSync(`which ${dep}`, { stdio: 'ignore' });
    } catch {
      missing.push(dep);
    }
  }
  return missing;
}

/**
 * Install a tool. Reports progress via the callback.
 *
 * For local monorepo tools the "install" is really just recording
 * the tool as installed and linking to the workspace package.
 * When the Hub goes remote, this will download and extract packages.
 */
export async function installTool(
  toolId: string,
  onProgress?: (progress: InstallProgress) => void,
): Promise<void> {
  const descriptor = getToolById(toolId);
  if (!descriptor) throw new Error(`Unknown tool: ${toolId}`);
  if (descriptor.comingSoon) throw new Error(`${descriptor.name} is coming soon.`);

  const report = (stage: InstallProgress['stage'], percent: number, message: string) => {
    onProgress?.({ toolId, stage, percent, message });
  };

  try {
    // 1. Check system dependencies
    report('checking-deps', 10, 'Checking system dependencies…');
    const missing = await checkSystemDeps(toolId);
    if (missing.length > 0) {
      const msg = `Missing system dependencies: ${missing.join(', ')}. Please install them first.`;
      report('failed', 0, msg);
      throw new Error(msg);
    }

    // 2. "Download" — for local tools this is a no-op
    report('downloading', 30, 'Resolving package…');
    await new Promise((r) => setTimeout(r, 300)); // brief pause for UX

    // 3. Install — record in manifest
    report('installing', 60, 'Installing tool…');
    await ensureDir();

    const manifest = await readManifest();
    const existing = manifest.tools.findIndex((t) => t.id === toolId);

    const entry: InstalledTool = {
      id: toolId,
      version: descriptor.version,
      installedAt: new Date().toISOString(),
      packagePath: descriptor.packageName,
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

    // 4. Done
    report('completed', 100, 'Installed successfully.');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Installation failed.';
    report('failed', 0, message);
    throw err;
  }
}

export async function uninstallTool(toolId: string): Promise<void> {
  const manifest = await readManifest();
  manifest.tools = manifest.tools.filter((t) => t.id !== toolId);
  // Note: we don't decrement downloadCounts — once counted, it stays
  await writeManifest(manifest);
}

export async function updateToolConfig(toolId: string, config: Record<string, any>): Promise<void> {
  const manifest = await readManifest();
  const tool = manifest.tools.find((t) => t.id === toolId);
  if (!tool) throw new Error(`Tool ${toolId} is not installed.`);
  tool.config = { ...tool.config, ...config };
  await writeManifest(manifest);
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
