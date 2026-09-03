import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ToolDescriptor } from './types';
import { DEFAULT_HUB_URL } from './types';

/**
 * Tool registry — resolves tool descriptors from multiple sources.
 */

/** Cached registry — populated on first access. */
let cachedRegistry: Record<string, ToolDescriptor> | null = null;

/** Kept loadable for installed workspaces, but no longer offered for new installs. */
const RETIRED_CATALOG_TOOL_IDS = new Set(['video-audio']);

function normalizeToolDescriptor(descriptor: ToolDescriptor): ToolDescriptor {
  return { ...descriptor, requiresSandbox: descriptor.requiresSandbox !== false };
}

/**
 * Compare the numeric portions of two semver versions. Marketplace manifests
 * use stable releases, but accepting a suffix keeps a pre-release catalog
 * entry from incorrectly outranking its corresponding stable release.
 */
function compareToolVersions(left: string, right: string): number {
  const parse = (version: string) => {
    const [core, suffix = ''] = version.split('-', 2);
    const parts = core.split('.').map((part) => Number.parseInt(part, 10) || 0);
    return { parts, stable: suffix.length === 0 };
  };
  const a = parse(left);
  const b = parse(right);
  const length = Math.max(a.parts.length, b.parts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (a.parts[index] ?? 0) - (b.parts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  if (a.stable === b.stable) return 0;
  return a.stable ? 1 : -1;
}

/**
 * Merge catalog entries without allowing an older Hub response or an already
 * installed package to downgrade the version users are offered.
 */
export function mergeToolDescriptors(
  current: Record<string, ToolDescriptor>,
  incoming: Record<string, ToolDescriptor>,
): Record<string, ToolDescriptor> {
  const merged = { ...current };
  for (const [id, descriptor] of Object.entries(incoming)) {
    const existing = merged[id];
    if (!existing || compareToolVersions(descriptor.version, existing.version) >= 0) {
      merged[id] = descriptor;
    }
  }
  return merged;
}

async function discoverLocalManifests(): Promise<Record<string, ToolDescriptor>> {
  const registry: Record<string, ToolDescriptor> = {};

  // Try multiple possible tool directories
  const searchPaths = [
    // Monorepo development: packages/marketplace-tools/*
    path.resolve(process.cwd(), 'packages', 'marketplace-tools'),
    // Next.js dev server runs in apps/web
    path.resolve(process.cwd(), '..', '..', 'packages', 'marketplace-tools'),
    // Installed tools: .larkup/tools/node_modules/@larkup
    path.resolve(process.cwd(), '.larkup', 'tools', 'node_modules', '@larkup'),
    path.resolve(process.cwd(), '..', '..', '.larkup', 'tools', 'node_modules', '@larkup'),
  ];

  for (const searchPath of searchPaths) {
    try {
      const entries = await fs.readdir(searchPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        // Check for tool.manifest.json in the directory
        const manifestPath = path.join(searchPath, entry.name, 'tool.manifest.json');
        try {
          const raw = await fs.readFile(manifestPath, 'utf8');
          const manifest = normalizeToolDescriptor(JSON.parse(raw) as ToolDescriptor);
          if (manifest.id && !RETIRED_CATALOG_TOOL_IDS.has(manifest.id)) {
            registry[manifest.id] = manifest;
          }
        } catch {
          // No manifest in this directory — skip
        }
      }
    } catch {
      // Directory doesn't exist — skip
    }
  }

  return registry;
}

/**
 * Fetch the full tool catalog from the remote Hub API.
 * Falls back gracefully if the Hub is unreachable.
 */
async function fetchHubCatalog(hubUrl?: string): Promise<Record<string, ToolDescriptor>> {
  const baseUrl = hubUrl ?? DEFAULT_HUB_URL;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(`${baseUrl}/v1/tools`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timeout);

    if (!res.ok) return {};

    const data = (await res.json()) as { tools: ToolDescriptor[] };
    const registry: Record<string, ToolDescriptor> = {};
    for (const tool of data.tools ?? []) {
      if (tool.id && !RETIRED_CATALOG_TOOL_IDS.has(tool.id)) {
        registry[tool.id] = normalizeToolDescriptor(tool);
      }
    }
    return registry;
  } catch {
    // Hub unreachable — offline mode
    return {};
  }
}

/**
 * Fetch a single tool descriptor from the Hub API.
 */
export async function fetchToolFromHub(
  toolId: string,
  hubUrl?: string,
): Promise<ToolDescriptor | null> {
  if (RETIRED_CATALOG_TOOL_IDS.has(toolId)) return null;
  const baseUrl = hubUrl ?? DEFAULT_HUB_URL;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(`${baseUrl}/v1/tools/${toolId}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timeout);

    if (!res.ok) return null;
    const data = (await res.json()) as { tool: ToolDescriptor };
    return data.tool ?? null;
  } catch {
    return null;
  }
}

/**
 * Minimal hardcoded registry for offline / first-run scenarios
 * where neither manifests nor Hub are available.
 */
const FALLBACK_REGISTRY: Record<string, ToolDescriptor> = {
  'clip-embeddings': {
    id: 'clip-embeddings',
    name: 'CLIP Image Search',
    description: 'Direct image-to-image similarity search using CLIP/SigLIP embeddings.',
    category: 'embedding',
    version: '0.1.0',
    pricing: 'free',
    emoji: '🔍',
    icon: 'ScanEye',
    packageName: '@larkup/tool-clip-embeddings',
    installSize: '~200 MB',
    requiresSandbox: true,
    author: 'Larkup',
    capabilities: ['clip-embeddings', 'image-similarity'],
    tags: ['clip', 'siglip', 'image-search', 'visual-similarity'],
    downloads: 0,
    repositoryUrl: 'https://github.com/Larkup-AI/larkup',
    license: 'Apache-2.0',
    updatedAt: '2026-07-20',
    comingSoon: true,
  },

  'doc-editor': {
    id: 'doc-editor',
    name: 'Document Editor',
    description: 'AI-powered form filling and document editing with Canvas-style live preview.',
    category: 'utility',
    version: '0.2.3',
    pricing: 'free',
    emoji: '📝',
    icon: 'FileEdit',
    packageName: '@larkup/tool-doc-editor',
    installSize: '~5 MB',
    systemDeps: ['docker'],
    requiresSandbox: true,
    author: 'Larkup',
    capabilities: ['document-editing', 'form-filling', 'document-preview'],
    tags: ['pdf', 'docx', 'pptx', 'form', 'canvas', 'editor', 'fill'],
    downloads: 0,
    repositoryUrl: 'https://github.com/Larkup-AI/larkup',
    license: 'Apache-2.0',
    updatedAt: '2026-07-20',
  },
};

/**
 * Build the full tool registry by merging sources. The deployed Hub is the
 * source of truth in normal operation; local manifests are a development and
 * offline recovery path, never a silent production override.
 * Cached after first call for the process lifetime.
 */
export async function buildRegistry(opts?: {
  hubUrl?: string;
  skipHub?: boolean;
  preferLocal?: boolean;
}): Promise<Record<string, ToolDescriptor>> {
  if (cachedRegistry) return cachedRegistry;

  // Start with hardcoded fallback.
  let registry = { ...FALLBACK_REGISTRY };

  // Layer Hub API catalog over the offline fallback. A non-empty response is
  // authoritative so every client sees the Neon-backed catalog consistently.
  let hubAvailable = false;
  if (!opts?.skipHub) {
    const hubCatalog = await fetchHubCatalog(opts?.hubUrl);
    if (Object.keys(hubCatalog).length > 0) {
      registry = mergeToolDescriptors(registry, hubCatalog);
      hubAvailable = true;
    }
  }

  if (!hubAvailable || opts?.preferLocal) {
    const localManifests = await discoverLocalManifests();
    registry = mergeToolDescriptors(registry, localManifests);
  }

  cachedRegistry = registry;
  return registry;
}

/** Force-refresh the registry cache (e.g., after installing a new tool). */
export function invalidateRegistryCache(): void {
  cachedRegistry = null;
}

/** All tools as a flat list, sorted by name. */
export async function getAllTools(): Promise<ToolDescriptor[]> {
  const registry = await buildRegistry();
  return Object.values(registry).sort((a, b) => a.name.localeCompare(b.name));
}

/** Lookup a single tool by id. */
export async function getToolById(id: string): Promise<ToolDescriptor | undefined> {
  const registry = await buildRegistry();
  return registry[id];
}

/** Tools that provide a specific capability. */
export async function getToolsWithCapability(capability: string): Promise<ToolDescriptor[]> {
  const all = await getAllTools();
  return all.filter((t) => t.capabilities.includes(capability));
}

/** Get all unique categories from the registry. */
export async function getAllCategories(): Promise<string[]> {
  const all = await getAllTools();
  const cats = new Set(all.map((t) => t.category));
  return Array.from(cats).sort();
}
