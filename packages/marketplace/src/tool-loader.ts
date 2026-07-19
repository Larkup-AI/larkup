import type { InstalledTool } from './types';
import { getInstalledTool } from './tool-installer';

/**
 * Dynamic tool loader — loads an installed tool's module at runtime.
 *
 * Uses dynamic import so heavy dependencies (ffmpeg bindings, whisper, etc.)
 * are only loaded when the tool is actually invoked. Modules are cached
 * for the lifetime of the process.
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
    const mod = await import(installed.packagePath);
    moduleCache.set(toolId, mod);
    return mod as T;
  } catch (err) {
    console.error(`[marketplace] Failed to load tool "${toolId}":`, err);
    return null;
  }
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
  const tools = getToolsWithCapability(capability);
  for (const t of tools) {
    const installed = await getInstalledTool(t.id);
    if (installed) return true;
  }
  return false;
}
