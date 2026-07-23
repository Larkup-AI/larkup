import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ToolDescriptor } from './types';
import { DEFAULT_HUB_URL } from './types';

/**
 * Tool registry — resolves tool descriptors from multiple sources.
 *
 * Resolution order:
 * 1. Local `tool.manifest.json` files from workspace packages
 * 2. Hub API (remote catalog) when available
 * 3. Hardcoded fallback for offline / development
 *
 * In the monorepo, tools under `packages/tools/` ship their own
 * `tool.manifest.json`. This registry reads those at startup.
 * When the Hub API is live, it supplements with remotely-published tools.
 */

/* ------------------------------------------------------------------ */
/* Local manifest discovery                                            */
/* ------------------------------------------------------------------ */

/** Cached registry — populated on first access. */
let cachedRegistry: Record<string, ToolDescriptor> | null = null;

/**
 * Scan workspace tool directories for `tool.manifest.json` files.
 * This is used in monorepo development and in Docker builds where
 * tools are bundled at build time.
 */
async function discoverLocalManifests(): Promise<Record<string, ToolDescriptor>> {
  const registry: Record<string, ToolDescriptor> = {};

  // Try multiple possible tool directories
  const searchPaths = [
    // Monorepo development: packages/tools/*
    path.resolve(process.cwd(), 'packages', 'tools'),
    // Next.js dev server runs in apps/web
    path.resolve(process.cwd(), '..', '..', 'packages', 'tools'),
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
          const manifest = JSON.parse(raw) as ToolDescriptor;
          if (manifest.id) {
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

/* ------------------------------------------------------------------ */
/* Hub API fetching                                                    */
/* ------------------------------------------------------------------ */

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
      if (tool.id) registry[tool.id] = tool;
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

/* ------------------------------------------------------------------ */
/* Hardcoded fallback (offline safety net)                              */
/* ------------------------------------------------------------------ */

/**
 * Minimal hardcoded registry for offline / first-run scenarios
 * where neither manifests nor Hub are available. This ensures the
 * marketplace always has something to show.
 */
const FALLBACK_REGISTRY: Record<string, ToolDescriptor> = {
  'video-audio': {
    id: 'video-audio',
    name: 'Video & Audio',
    description: 'Index video and audio files with transcription and frame analysis.',
    category: 'media',
    version: '0.1.0',
    pricing: 'free',
    emoji: '🎬',
    icon: 'Film',
    packageName: '@larkup/tool-video-audio',
    installSize: '~15 MB',
    systemDeps: ['ffmpeg'],
    author: 'Larkup',
    capabilities: [
      'video-indexing',
      'audio-indexing',
      'transcription',
      'frame-extraction',
      'youtube-import',
    ],
    tags: ['transcription', 'ffmpeg', 'video', 'audio', 'whisper'],
    downloads: 0,
    repositoryUrl: 'https://github.com/Larkup-AI/larkup-rag',
    license: 'Apache-2.0',
    updatedAt: '2026-07-20',
    configSchema: [
      {
        key: 'frameInterval',
        label: 'Frame extraction interval (seconds)',
        type: 'text',
        defaultValue: '10',
        help: 'Extract one keyframe every N seconds from video files.',
      },
      {
        key: 'audioProvider',
        label: 'Audio Provider',
        type: 'select',
        defaultValue: 'openai',
        help: 'Provider to use for transcription. Leave empty to use Chat Provider if it supports audio.',
        options: [
          { label: 'OpenAI', value: 'openai' },
          { label: 'Google', value: 'google' },
          { label: 'Groq', value: 'groq' },
          { label: 'Deepgram', value: 'deepgram' },
          { label: 'ElevenLabs', value: 'elevenlabs' },
          { label: 'Local Whisper', value: 'local' },
          { label: 'Vercel AI Gateway', value: 'vercel_ai_gateway' },
        ],
      },
      {
        key: 'audioApiKey',
        label: 'Audio API Key',
        type: 'password',
        help: 'Optional if covered by your Chat API key. Required otherwise.',
      },
    ],
  },

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
    author: 'Larkup',
    capabilities: ['clip-embeddings', 'image-similarity'],
    tags: ['clip', 'siglip', 'image-search', 'visual-similarity'],
    downloads: 0,
    repositoryUrl: 'https://github.com/Larkup-AI/larkup-rag',
    license: 'Apache-2.0',
    updatedAt: '2026-07-20',
    comingSoon: true,
  },

  'doc-editor': {
    id: 'doc-editor',
    name: 'Document Editor',
    description: 'AI-powered form filling and document editing with Canvas-style live preview.',
    category: 'utility',
    version: '0.1.0',
    pricing: 'free',
    emoji: '📝',
    icon: 'FileEdit',
    packageName: '@larkup/tool-doc-editor',
    installSize: '~5 MB',
    systemDeps: ['docker'],
    author: 'Larkup',
    capabilities: ['document-editing', 'form-filling', 'document-preview'],
    tags: ['pdf', 'docx', 'pptx', 'form', 'canvas', 'editor', 'fill'],
    downloads: 0,
    repositoryUrl: 'https://github.com/Larkup-AI/larkup-rag',
    license: 'Apache-2.0',
    updatedAt: '2026-07-20',
  },
};

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Build the full tool registry by merging sources.
 * Priority: local manifests > Hub API > hardcoded fallback.
 * Cached after first call for the process lifetime.
 */
export async function buildRegistry(opts?: {
  hubUrl?: string;
  skipHub?: boolean;
}): Promise<Record<string, ToolDescriptor>> {
  if (cachedRegistry) return cachedRegistry;

  // Start with hardcoded fallback
  const registry = { ...FALLBACK_REGISTRY };

  // Layer local manifests on top (they're the most up-to-date for development)
  const localManifests = await discoverLocalManifests();
  Object.assign(registry, localManifests);

  // Layer Hub API catalog on top (newest published versions)
  if (!opts?.skipHub) {
    const hubCatalog = await fetchHubCatalog(opts?.hubUrl);
    Object.assign(registry, hubCatalog);
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
