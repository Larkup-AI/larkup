import type { ToolDescriptor } from './types';

/**
 * Hardcoded registry of all available marketplace tools.
 *
 * In the future this can be backed by a remote API (the Larkup Hub)
 * that serves tool descriptors, handles subscription checks, and hosts
 * downloadable packages. For now everything lives locally.
 *
 * Each entry conforms to the ToolDescriptor manifest schema (v1.0).
 */

export const TOOL_REGISTRY: Record<string, ToolDescriptor> = {
  'video-audio': {
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
    updatedAt: '2026-07-19',
    configSchema: [
      {
        key: 'frameInterval',
        label: 'Frame extraction interval (seconds)',
        type: 'text',
        defaultValue: '10',
        help: 'Extract one keyframe every N seconds from video files.',
      },
      {
        key: 'transcriptionProvider',
        label: 'Transcription method',
        type: 'select',
        defaultValue: 'api',
        help: "Use your AI provider's API or local Whisper model.",
        options: [
          { label: 'AI Provider API (recommended)', value: 'api' },
          { label: 'Local Whisper', value: 'local' },
        ],
      },
    ],
  },

  'clip-embeddings': {
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
    updatedAt: '2026-07-19',
    comingSoon: true,
  },

  'doc-editor': {
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
    updatedAt: '2026-07-19',
  },
};

/** All tools as a flat list, sorted by name. */
export function getAllTools(): ToolDescriptor[] {
  return Object.values(TOOL_REGISTRY).sort((a, b) => a.name.localeCompare(b.name));
}

/** Lookup a single tool by id. */
export function getToolById(id: string): ToolDescriptor | undefined {
  return TOOL_REGISTRY[id];
}

/** Tools that provide a specific capability. */
export function getToolsWithCapability(capability: string): ToolDescriptor[] {
  return getAllTools().filter((t) => t.capabilities.includes(capability));
}

/** Get all unique categories from the registry. */
export function getAllCategories(): string[] {
  const cats = new Set(getAllTools().map((t) => t.category));
  return Array.from(cats).sort();
}
