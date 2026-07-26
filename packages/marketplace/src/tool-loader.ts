import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { InstalledTool } from './types';
import { getInstalledTool } from './tool-installer';

/**
 * Dynamic tool loader — loads an installed tool's module at runtime.
 *
 * Resolution strategy:
 * ─────────────────────────────────────────────────────────────────────
 * 1. Check if the tool is recorded in `installed.json`
 * 2. Use the `resolvedPath` from the install record:
 *    - For `local` (workspace): points to the monorepo package
 *    - For `registry` (npm): points to `.larkup/tools/node_modules/...`
 *    - For `sandbox`: points to the sandbox's tool directory
 * 3. Dynamic `import()` the resolved path
 * 4. Cache the module for the lifetime of the process
 * ─────────────────────────────────────────────────────────────────────
 *
 * Heavy dependencies (ffmpeg bindings, whisper, pdf-lib, etc.) are
 * only loaded when the tool is actually invoked via this loader.
 */

const moduleCache = new Map<string, any>();

/**
 * Load a tool's exported API. Returns `null` if the tool is not installed.
 *
 * The returned object is whatever the tool's entry point exports —
 * each tool defines its own public surface.
 */
export async function loadTool<T = any>(toolId: string): Promise<T | null> {
  // Check cache first
  if (moduleCache.has(toolId)) return moduleCache.get(toolId) as T;

  const installed = await getInstalledTool(toolId);
  if (!installed) return null;

  try {
    // Determine what to import
    const importPath = await resolveImportPath(installed);
    const mod = await import(/* webpackIgnore: true */ importPath);
    moduleCache.set(toolId, mod);
    return mod as T;
  } catch (err) {
    console.error(`[marketplace] Failed to load tool "${toolId}":`, err);
    return null;
  }
}

/**
 * Resolve the import path for a tool based on its install source.
 *
 * - `local` (workspace): import by package name (Node resolves via workspace symlink)
 * - `registry` (npm): import from the isolated node_modules via absolute path
 * - `sandbox`: import from the sandbox tool path
 */
async function resolveImportPath(installed: InstalledTool): Promise<string> {
  switch (installed.source) {
    case 'local':
      // In monorepo, the package name resolves via pnpm workspace linking
      return installed.packageName;

    case 'registry':
    case 'sandbox':
      // Node ESM cannot import a package directory by absolute path. Resolve
      // the package's declared ESM entry so isolated marketplace installs work
      // the same way as a normal package-name import.
      return resolvePackageEntry(installed.resolvedPath);

    default:
      // Fallback: try package name (backwards compat)
      return installed.packageName;
  }
}

async function resolvePackageEntry(packageDir: string): Promise<string> {
  const manifestPath = path.join(packageDir, 'package.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as {
    exports?: string | { '.': string | { import?: string; default?: string } };
    main?: string;
  };
  const rootExport =
    typeof manifest.exports === 'object' ? manifest.exports['.'] : manifest.exports;
  const entry =
    (typeof rootExport === 'object' ? rootExport.import ?? rootExport.default : rootExport) ??
    manifest.main ??
    'index.js';

  return pathToFileURL(path.resolve(packageDir, entry)).href;
}

/**
 * Check if a tool is loaded and available for use.
 */
export function isToolLoaded(toolId: string): boolean {
  return moduleCache.has(toolId);
}

/**
 * Evict a tool from the module cache (e.g. after uninstall).
 */
export function unloadTool(toolId: string): void {
  moduleCache.delete(toolId);
}

/**
 * Check whether a specific capability is available (i.e. a tool
 * providing that capability is installed).
 */
export async function hasCapability(capability: string): Promise<boolean> {
  const { getToolsWithCapability } = await import('./tool-registry');
  const tools = await getToolsWithCapability(capability);
  for (const t of tools) {
    const installed = await getInstalledTool(t.id);
    if (installed) return true;
  }
  return false;
}
