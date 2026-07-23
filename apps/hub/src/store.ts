import type { ToolDescriptor, ToolCategory, ToolPricing } from './types.js';

/**
 * In-memory tool store for the Hub API.
 *
 * MVP: tools are loaded from a static registry.
 * Future: backed by Turso (SQLite) for persistence,
 * with publish webhooks from GitHub Actions CI.
 *
 * The store tracks:
 * - Tool manifests (from tool.manifest.json files)
 * - Server-side install counts
 * - Version history
 */

// TODO:: use online db for storage like neno

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface HubTool {
  manifest: ToolDescriptor;
  installs: number;
  publishedAt: string;
  updatedAt: string;
}

export interface HubToolVersion {
  toolId: string;
  version: string;
  manifest: ToolDescriptor;
  publishedAt: string;
}

/* ------------------------------------------------------------------ */
/* In-memory store                                                     */
/* ------------------------------------------------------------------ */

const tools = new Map<string, HubTool>();
const versions = new Map<string, HubToolVersion[]>();

/**
 * Seed the store with the built-in Larkup tools.
 * Called at startup. In the future, this will be replaced by
 * Turso database reads.
 */
export function seedRegistry(): void {
  const builtinTools: ToolDescriptor[] = [
    {
      id: 'video-audio',
      name: 'Video & Audio',
      description: 'Index video and audio files with transcription and frame analysis.',
      longDescription:
        'Process video and audio files for your knowledge base. ' +
        'Extracts audio transcripts using AI speech-to-text, captures keyframes from video, ' +
        'and generates scene descriptions using vision models. Supports YouTube URLs, ' +
        'direct file upload, and bulk processing. Requires ffmpeg on your system.',
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
          help: 'Fallback interval used when scene-change detection finds no frames.',
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
    {
      id: 'clip-embeddings',
      name: 'CLIP Image Search',
      description: 'Direct image-to-image similarity search using CLIP/SigLIP embeddings.',
      longDescription:
        'Enable native visual similarity search by embedding images with CLIP or SigLIP models. ' +
        "Search your image library by uploading a query image or describing what you're looking for. " +
        'Requires downloading a ~200MB model on first use.',
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
    {
      id: 'doc-editor',
      name: 'Document Editor',
      description: 'AI-powered form filling and document editing with Canvas-style live preview.',
      longDescription:
        'Open PDF, Word, PowerPoint, and text files in a split-view Canvas. ' +
        'AI fills forms using your knowledge base, edits content on request, and previews changes live. ' +
        'Supports PDF form fields (AcroForm), DOCX paragraphs/tables, PPTX slide text, and plain text editing. ' +
        'Uses pdf-lib (native) for PDF and the Docker sandbox for DOCX/PPTX via python-docx/python-pptx.',
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
  ];

  const now = new Date().toISOString();
  for (const manifest of builtinTools) {
    tools.set(manifest.id, {
      manifest,
      installs: 0,
      publishedAt: now,
      updatedAt: now,
    });
    versions.set(manifest.id, [
      { toolId: manifest.id, version: manifest.version, manifest, publishedAt: now },
    ]);
  }
}

/* ------------------------------------------------------------------ */
/* Query API                                                           */
/* ------------------------------------------------------------------ */

export function getAllHubTools(): HubTool[] {
  return Array.from(tools.values()).sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
}

export function getHubTool(toolId: string): HubTool | undefined {
  return tools.get(toolId);
}

export function getHubToolVersions(toolId: string): HubToolVersion[] {
  return versions.get(toolId) ?? [];
}

export function incrementInstallCount(toolId: string): number {
  const tool = tools.get(toolId);
  if (!tool) return 0;
  tool.installs += 1;
  tool.manifest.downloads = (tool.manifest.downloads ?? 0) + 1;
  return tool.installs;
}

export function getToolsByCategory(category: string): HubTool[] {
  return getAllHubTools().filter((t) => t.manifest.category === category);
}

export function searchTools(query: string): HubTool[] {
  const q = query.toLowerCase();
  return getAllHubTools().filter(
    (t) =>
      t.manifest.name.toLowerCase().includes(q) ||
      t.manifest.description.toLowerCase().includes(q) ||
      t.manifest.tags?.some((tag) => tag.toLowerCase().includes(q)) ||
      t.manifest.author.toLowerCase().includes(q),
  );
}

/**
 * Publish or update a tool in the Hub.
 * Called by CI webhooks after `npm publish`.
 */
export function publishTool(manifest: ToolDescriptor): void {
  const now = new Date().toISOString();
  const existing = tools.get(manifest.id);

  tools.set(manifest.id, {
    manifest,
    installs: existing?.installs ?? 0,
    publishedAt: existing?.publishedAt ?? now,
    updatedAt: now,
  });

  const versionList = versions.get(manifest.id) ?? [];
  versionList.push({
    toolId: manifest.id,
    version: manifest.version,
    manifest,
    publishedAt: now,
  });
  versions.set(manifest.id, versionList);
}
