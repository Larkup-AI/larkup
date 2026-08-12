/**
 * Manifest data for the tools Larkup ships built in.
 *
 * This is the exact content `apps/hub/src/store.ts`'s `seedRegistry()`
 * hard-coded before the Hub moved off its in-memory store (TASK 03) — kept
 * here, not trimmed, because `longDescription` and `configSchema` are real
 * product copy other code and tests depend on
 * (`e2e/tests/api/gateway-fallbacks.spec.ts` asserts on
 * `video-audio`'s `longDescription`), not filler. `seed.ts` publishes these
 * through the same validated path a real publisher uses; nothing reads this
 * array directly except that publish call and the tests that need the raw
 * content without a database.
 */
export const BUILTIN_TOOLS: Record<string, unknown>[] = [
  {
    id: 'video-audio',
    name: 'Video Intelligence',
    description:
      'Build evidence-backed video timelines with adaptive attention and bounded source rewind.',
    longDescription:
      'Evidence-first video reasoning for your knowledge base. ' +
      'Creates multilingual transcripts, activity-aware visual/OCR evidence, timestamped source ranges, ' +
      'and bounded rewind for complex questions. Supports YouTube URLs, ' +
      'direct file upload, and bulk processing. Includes ffmpeg automatically and prepares the YouTube downloader on first use.',
    category: 'media',
    version: '0.3.6',
    pricing: 'free',
    emoji: '🎬',
    icon: 'Film',
    packageName: '@larkup/tool-video-audio',
    installSize: '~15 MB',
    author: 'Larkup',
    capabilities: [
      'video-indexing',
      'audio-indexing',
      'transcription',
      'frame-extraction',
      'youtube-import',
      'attention-driven-analysis',
      'temporal-evidence',
      'bounded-source-rewind',
    ],
    tags: ['video intelligence', 'temporal reasoning', 'transcription', 'ffmpeg', 'video', 'audio'],
    repositoryUrl: 'https://github.com/Larkup-AI/larkup',
    license: 'Apache-2.0',
    updatedAt: '2026-07-20',
    configSchema: [
      {
        key: 'frameInterval',
        label: 'Baseline coverage interval (seconds)',
        type: 'text',
        defaultValue: '10',
        help: 'Baseline cadence for duration-aware coverage frames; scene changes and a reserved ending pass are added separately.',
      },
      {
        key: 'audioProvider',
        label: 'Audio Provider',
        type: 'select',
        help: 'Choose the provider used only for audio and video transcription.',
        options: [
          { label: 'OpenAI', value: 'openai' },
          { label: 'Groq', value: 'groq' },
          { label: 'Deepgram', value: 'deepgram' },
          { label: 'ElevenLabs', value: 'elevenlabs' },
          { label: 'Local Whisper', value: 'local' },
        ],
      },
      {
        key: 'audioLanguage',
        label: 'Transcription language',
        type: 'text',
        defaultValue: 'auto',
        help: 'Use auto for provider language detection, or enter a language code such as ar, ar-EG, en, or de to override it.',
      },
      {
        key: 'audioApiKey',
        label: 'Audio API Key',
        type: 'password',
        help: 'Required for the selected audio provider and kept separate from the chat model key.',
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
    repositoryUrl: 'https://github.com/Larkup-AI/larkup',
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
    version: '0.2.3',
    pricing: 'free',
    emoji: '📝',
    icon: 'FileEdit',
    packageName: '@larkup/tool-doc-editor',
    installSize: '~5 MB',
    systemDeps: ['docker'],
    author: 'Larkup',
    capabilities: ['document-editing', 'form-filling', 'document-preview'],
    tags: ['pdf', 'docx', 'pptx', 'form', 'canvas', 'editor', 'fill'],
    repositoryUrl: 'https://github.com/Larkup-AI/larkup',
    license: 'Apache-2.0',
    updatedAt: '2026-07-20',
  },
];
