import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { InstalledTool } from './types';
import { getInstalledTool, resolveWorkspaceToolPath } from './tool-installer';

/**
 * Dynamic tool loader — loads an installed tool's module at runtime.
 */

const moduleCache = new Map<string, { installationKey: string; module: unknown }>();

// A tool's compiled entry can still transitively import a workspace package
// (e.g. `@larkup/core`) whose own exports point at its raw TypeScript source
// for bundler consumers -- Node's native ESM resolver cannot follow that or
// the extension-less relative imports inside it. A namespaced tsx loader
// (already a resolvable dependency here) is scoped to only this import path,
// so it does not affect module resolution anywhere else in the process.
type ScopedImport = (specifier: string, parent: string) => Promise<unknown>;
const scopedImports = new Map<string, ScopedImport>();

/**
 * A query string busts the cache for the *entry* module only -- the relative
 * imports inside it resolve to plain paths Node has already cached, so a
 * rebuilt tool kept serving its old implementation with only a fresh
 * entry wrapper around it. Each namespace has its own module registry, so
 * giving a rebuilt workspace tool a new namespace reloads the whole subgraph.
 * Published installs are immutable and keep one namespace for the process.
 */
async function getScopedImport(revision: string) {
  const namespace = `larkup-marketplace-tools${revision === 'fixed' ? '' : `-${revision}`}`;
  const existing = scopedImports.get(namespace);
  if (existing) return existing;
  const { register } = await import(/* webpackIgnore: true */ 'tsx/esm/api');
  const importer = register({ namespace }).import as ScopedImport;
  // Only the newest build of a given tool is ever imported again; keeping
  // every namespace a long dev session produced would retain each one's
  // module registry for the life of the process.
  if (scopedImports.size >= 8) {
    scopedImports.delete(scopedImports.keys().next().value as string);
  }
  scopedImports.set(namespace, importer);
  return importer;
}

/**
 * Load a tool's exported API. Returns `null` if the tool is not installed.
 */
export async function loadTool<T = any>(toolId: string): Promise<T | null> {
  const installed = await getInstalledTool(toolId);
  if (!installed) return null;
  // Determine what to import
  const importPath = await resolveImportPath(installed);
  const revision = await entryRevision(installed, importPath);
  const installationKey = `${installed.source}:${installed.resolvedPath}:${installed.version}:${installed.installedAt}:${revision}`;
  const cached = moduleCache.get(toolId);
  if (cached?.installationKey === installationKey) return cached.module as T;

  try {
    const busted = cacheBustFileImport(importPath, installationKey);
    const importer = await getScopedImport(revision);
    const mod = await importer(busted, import.meta.url);
    moduleCache.set(toolId, { installationKey, module: mod });
    return mod as T;
  } catch (err) {
    console.error(`[marketplace] Failed to load tool "${toolId}":`, err);
    return null;
  }
}

/**
 * A workspace tool is developed in place: its entry is rebuilt from source
 * while the host keeps running, and nothing about the *installation* changes
 * when that happens. Node's ESM cache is process-wide and unaffected by the
 * host's own hot reload, so without this a rebuilt tool kept serving the
 * build that was current when the server started. Published installs are
 * immutable, so they keep the cheaper key.
 */
async function entryRevision(installed: InstalledTool, importPath: string): Promise<string> {
  if (installed.source !== 'local' || !importPath.startsWith('file:')) return 'fixed';
  try {
    // The whole build output, not just the entry: a change is far more often
    // in a module the entry re-exports than in the entry file itself.
    const directory = path.dirname(new URL(importPath).pathname);
    const files = await fs.readdir(directory, { withFileTypes: true });
    let newest = 0;
    let total = 0;
    for (const file of files) {
      if (!file.isFile()) continue;
      const { mtimeMs, size } = await fs.stat(path.join(directory, file.name));
      newest = Math.max(newest, mtimeMs);
      total += size;
    }
    return newest > 0 ? `${newest}-${total}` : 'fixed';
  } catch {
    return 'fixed';
  }
}

/** A reinstall may keep the same local path, so key file imports by installation too. */
function cacheBustFileImport(importPath: string, installationKey: string): string {
  if (!importPath.startsWith('file:')) return importPath;
  const url = new URL(importPath);
  url.searchParams.set('larkup-installation', installationKey);
  return url.href;
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
        // Local manifest entries can outlive a workspace directory rename.
        // Re-discover the package before asking Node to resolve its specifier
        // from the host app's node_modules directory.
        const workspacePath = await resolveWorkspaceToolPath(installed.packageName);
        if (workspacePath) return resolvePackageEntry(workspacePath);
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
