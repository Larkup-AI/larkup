import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { InstalledTool } from './types';
import { getInstalledTool } from './tool-installer';

/**
 * Dynamic tool loader — loads an installed tool's module at runtime.
 */

const moduleCache = new Map<string, any>();

/**
 * Load a tool's exported API. Returns `null` if the tool is not installed.
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
 */
async function resolveImportPath(installed: InstalledTool): Promise<string> {
  switch (installed.source) {
    case 'local': {
      // Workspace tools are recorded with their absolute package directory so
      // Next.js can load them even when pnpm has not linked the package into
      // the app's node_modules tree yet. Older manifests still fall back to
      // the package specifier.
      try {
        await fs.access(path.join(installed.resolvedPath, 'package.json'));
        return resolvePackageEntry(installed.resolvedPath);
      } catch {
        return installed.packageName;
      }
    }

    case 'registry':
    case 'sandbox':
      return resolvePackageEntry(installed.resolvedPath);

    default:
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
