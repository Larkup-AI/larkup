import type {
  FieldType,
  IndexType,
  StoreField,
  StoreFieldOption,
  StoreRuntime,
  VectorStoreDescriptor,
  VectorStoreId,
} from '@larkup/vector-stores/types';

export type {
  FieldType,
  IndexType,
  StoreField,
  StoreFieldOption,
  StoreRuntime,
  VectorStoreDescriptor,
  VectorStoreId,
};

export type EmbeddingProvider =
  | 'openai'
  | 'google'
  | 'cohere'
  | 'voyage'
  | 'mistral'
  | 'jina'
  | 'nomic'
  | 'custom'
  | 'vercel_ai_gateway'
  | 'deepseek';

export interface CustomModelConfig {
  baseUrl: string;
  apiKey?: string;
  modelName: string;
  dimensions?: number;
}

export interface EmbeddingModelDescriptor {
  id: string;
  label: string;
  provider: EmbeddingProvider;
  /** output vector dimensions */
  dimensions: number;
  /** max input tokens per request */
  maxInputTokens: number;
  description: string;
}

export interface ChunkingParams {
  /** target chunk size in tokens */
  chunkSize: number;
  /** overlap between chunks in tokens */
  chunkOverlap: number;
  /** split strategy */
  strategy: 'recursive' | 'sentence' | 'fixed';
}

export interface RagConfig {
  /** project label, used when generating the server */
  projectName: string;
  embeddingProvider: string;
  embeddingApiKey?: string;
  embeddingModelId: string;
  customEmbeddings?: CustomModelConfig[];
  indexType: IndexType;
  chunking: ChunkingParams;
  vectorStore: VectorStoreId;
  /** dynamic, store-specific values keyed by StoreField.key */
  storeConfig: Record<string, string>;
  /** topK default used by the generated server + demo */
  topK: number;
  /** Optional: LLM model for the Chat demo. Auto-selected from provider if omitted. */
  chatModelId?: string;
  chatProvider?: string;
  chatApiKey?: string;
  customChatModels?: CustomModelConfig[];
  /** Optional dedicated vision-language model used by media and image tools. */
  visionProvider?: string;
  visionModelId?: string;
  visionApiKey?: string;
  customVisionModels?: CustomModelConfig[];

  /** dynamic tool configuration */
  toolConfigs?: Record<string, Record<string, any>>;

  /** Runtime-only package descriptors used when an Agent Server is generated. */
  agentPlugins?: Array<{ id: string; name?: string; packageName: string; version?: string }>;

  /** Portable Agent Skills available to the Assistant. Inline skills store a
   * SKILL.md document; remote skills retain their canonical URL. */
  skills?: AgentSkill[];

  chatSuggestions?: string[];
  systemPrompt?: string;
  serperApiKey?: string;
  webSearchEnabled?: boolean;
  webSearchProvider?: 'tavily' | 'serper' | 'google' | 'brave' | 'bing' | 'exa' | 'local';
  tavilyApiKey?: string;
  googleApiKey?: string;
  braveApiKey?: string;
  bingApiKey?: string;
  exaApiKey?: string;
  scraperProxyServer?: string;
  scraperProxyUsername?: string;
  scraperProxyPassword?: string;
  useScraperProxy?: boolean;
  webCrawlerProvider?: 'local' | 'cloud';
  firecrawlApiKey?: string;

  /** Default sandbox backend offered to agents that need code execution (see @larkup/sandbox). */
  defaultSandboxProvider?: string;
  /** Per-provider sandbox credentials, keyed by provider id then by that provider's field key. */
  sandboxProviderConfigs?: Record<string, Record<string, string>>;

  updatedAt: string;
  enabledTools?: string[];
  /** Presentation settings for the embeddable Assistant chat widget. */
  widget?: {
    title?: string;
    welcomeMessage?: string;
    placeholder?: string;
    primaryColor?: string;
    position?: 'bottom-right' | 'bottom-left';
    darkMode?: boolean;
    customCss?: string;
    logoUrl?: string;
  };
  /** Which profile the unified local Larkup Server exposes. */
  runtimeProfile?: 'knowledge' | 'assistant';
  /**
   * A locally enrolled Enterprise profile. The Dashboard owns its policy and
   * private tools; this only stores the client credential needed to retrieve it.
   */
  enterprise?: {
    organizationId: string;
    organizationName: string;
    dashboardUrl: string;
    installationId: string;
    clientKey: string;
    managedToolIds: string[];
    enrolledAt: string;
    /** Last-synced version of the Enterprise Profile (`GET /api/client/config`). `larkup update --ee` compares against this. */
    configurationVersion?: number;
  };
}

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  source: 'inline' | 'remote';
  /** Disabled skills remain configured but are not added to agent instructions. */
  enabled?: boolean;
  /** Complete SKILL.md contents for an inline skill. */
  content?: string;
  /** Canonical SKILL.md URL for a remote skill. */
  url?: string;
  updatedAt: string;
}

export const DEFAULT_CONFIG: RagConfig = {
  projectName: 'my-larkup',
  embeddingProvider: 'openai',
  embeddingApiKey: '',
  embeddingModelId: 'openai/text-embedding-3-small',
  indexType: 'hybrid',
  chunking: {
    chunkSize: 512,
    chunkOverlap: 64,
    strategy: 'recursive',
  },
  vectorStore: 'lancedb',
  storeConfig: {
    mode: 'local',
    dbPath: './.larkup/lancedb',
    tableName: 'documents',
  },
  topK: 5,
  serperApiKey: '',
  webSearchEnabled: false,
  webSearchProvider: 'tavily',
  tavilyApiKey: '',
  googleApiKey: '',
  braveApiKey: '',
  bingApiKey: '',
  exaApiKey: '',
  chatModelId: '',
  chatApiKey: '',
  visionModelId: '',
  visionApiKey: '',
  scraperProxyServer: '',
  scraperProxyUsername: '',
  scraperProxyPassword: '',
  useScraperProxy: false,
  webCrawlerProvider: 'local',
  firecrawlApiKey: '',
  defaultSandboxProvider: 'local',
  sandboxProviderConfigs: {},
  toolConfigs: {},
  skills: [],
  updatedAt: new Date(0).toISOString(),
};

export const DEFAULT_SYSTEM_PROMPT = `You are a retrieval assistant. Answer questions only with information found in the user's provided material.

You have these tools:
1. "searchKnowledgeBase" — semantic search over the RAG knowledge base. Returns top-K most relevant document chunks.
2. "presentMedia" — embeds one indexed image, video segment, or audio segment as a compact chat citation.
3. "getIndexedData" — structured access to ALL indexed source documents. Returns document metadata (title, source, status, metadata fields, dates). Use for counting, listing, filtering, and overview questions.
4. "analyzeCorpusWithCode" — runs Python code in a sandbox with the FULL corpus available as a CSV/JSONL file. Use for complex analysis of hundreds/thousands of documents.
5. "queryTabularData" — queries stored tabular datasets (CSV/Excel/JSON) for exact values, aggregations, filtering, and grouping.
6. "generateVisualization" — generates interactive charts to visualize data trends.
7. "executeAnalysis" — runs Python code in a sandbox for deep statistical analysis on tabular datasets.

TOOL SELECTION STRATEGY:
1. Search the provided material before answering a substantive request.
2. Answer only when the retrieved material supports the answer.
3. If the material does not contain the answer, say: "I couldn't find information about that in the available material."
4. Do not answer from general knowledge, browse the web, or invent details.

IMPORTANT — getIndexedData vs analyzeCorpusWithCode:
- Use getIndexedData for simple questions: counts, lists, filtering by source/status/metadata.
- Use analyzeCorpusWithCode when you need to PROCESS the actual content: parse fields from text, group by patterns, compute progress percentages, detect duplicates, or analyze metadata programmatically.
- analyzeCorpusWithCode gives you the corpus as 'corpus.csv' with columns: id, title, source, url, charCount, status, createdAt, content, plus any metadata_* columns.
- Example: "Show todo progress" → analyzeCorpusWithCode to parse status from content/metadata, compute percentages.
- Example: "How many docs are scraped?" → getIndexedData with source filter (simpler).

CRITICAL RULES FOR CHARTS AND VISUALIZATIONS:
- You MUST ALWAYS use the "generateVisualization" tool to display ANY visual data, trends, or charts.
- The UI strictly requires the "generateVisualization" tool to render interactive charts. Text-based approximations will not work.
- CRITICAL: You MUST populate the 'data' array in the 'generateVisualization' tool call with the exact rows of data you want to plot. Do NOT leave it empty.
- You CANNOT generate a chart from thin air. ALWAYS get the data FIRST (via getIndexedData, queryTabularData, or analyzeCorpusWithCode), THEN call generateVisualization with that actual data.
- The UI renders generateVisualization output as an interactive Recharts chart.

CRITICAL RULES FOR IMAGES AND KNOWLEDGE BASE:
- Never emit Markdown image syntax (![alt](url)) or invent an image URL. The chat renderer does not trust model-supplied image URLs.
- To show an indexed image, use presentMedia with the exact mediaAssetId returned by search results. The UI will render the verified local media citation for you.
- If no exact mediaAssetId is available, describe the image in text and say that a preview is unavailable; do not fabricate or link to an image.
- The image description in the search results is only a brief, high-level summary.
- If the user asks a detailed or structural question about an image (e.g., "what columns are in the film table in the diagram?", "how many items are listed?"), you MUST use the "analyzeImageDeeply" tool. Pass the 'imageUrl' and a detailed prompt to get the exact information you need directly from the image before answering.
- Do not hallucinate or guess details about images. If the high-level summary doesn't contain the answer, use analyzeImageDeeply.
- IF A QUESTION PLAUSIBLY REFERS TO CONTENT THE USER INDEXED, search the knowledge base once before answering. Do not search for unrelated general questions, and do not repeat a search when prior results already contain the answer.
- Questions about the user's preferences, files, database, diagrams, or anything the assistant "has" are always plausibly about indexed content. Search before answering instead of relying on general knowledge.
- FOR INDEXED AUDIO OR VIDEO: search when the requested fact is not already available in the conversation. For follow-up requests to show or play a known moment, call presentMedia directly with the earlier result's mediaAssetId and timestamps.
- FOR ANY VIDEO CLAIM: distinguish direct observations (visible text, spoken statements, or directly observed actions) from inferences. Direct evidence is stronger than a reaction, interpretation, or summary. When evidence is incomplete or conflicts, inspect the relevant range and state only what the returned evidence establishes. Present the result naturally; never expose transcript, frame, model, tool, retrieval, or analysis-process terminology unless the user specifically asks.
- MEDIA CITATIONS: present at most one best media item by default. Use presentMedia when the user explicitly asks for a preview or when one preview materially supports the answer. Never display every media search hit.
- IF THE KNOWLEDGE BASE SEARCH RETURNS EMPTY OR IRRELEVANT RESULTS, YOU MUST CLEARLY STATE THAT YOU DO NOT HAVE THE INFORMATION. DO NOT HALLUCINATE OR GUESS THE ANSWER BASED ON YOUR PRE-TRAINED KNOWLEDGE UNLESS EXPLICITLY ASKED TO DO SO.

RESPONSE FORMATTING (Analytics Style):
- Default to a direct, minimal answer. One to three sentences is usually sufficient.
- When answering questions based on RAG knowledge base results or tabular data query results, format your response in a clean, professional, and visually appealing way.
- Use headers only when the answer is complex enough to need sections.
- Use bulleted lists instead of dense paragraphs whenever you are listing items, points, metrics, or comparisons.
- Keep sentences concise. Avoid overly long introductions or conclusions. Get straight to the data.
- Highlight important numbers, metrics, or proper nouns in **bold**.
- Structure complex responses logically (e.g., Summary -> Key Metrics -> Breakdown).
- If your findings contain a small table of data, format it cleanly using Markdown tables.
- DO NOT hallucinate facts; rely strictly on the provided query results.
- End with a one-sentence synthesis if appropriate, avoiding filler words.`;

/** How a document entered the corpus. */
export type DocumentSource = 'text' | 'files' | 'website' | 'media' | 'integrations';

/** A user-facing knowledge group inside one Project. */
export interface DataGroup {
  id: string;
  name: string;
  description?: string;
  /** Emoji icon or safe image URL shown on the group card. */
  icon?: string;
  /** Disabled groups stay stored and indexed but cannot be retrieved by the Project Assistant. */
  assistantEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * A single cleaned document in the corpus. This is the unit that Phase 3
 * chunks + embeds. Stored locally as the ETL runs so nothing is lost if a
 * long crawl is interrupted.
 */
export interface SourceDocument {
  id: string;
  title: string;
  /** origin URL for scraped/uploaded-from-web docs */
  url?: string;
  source: DocumentSource;
  /** cleaned markdown / plain text */
  content: string;
  charCount: number;
  /** crawl job that produced this doc, if any */
  jobId?: string;
  /** The one user-facing Data group that owns this source. */
  groupId?: string;
  /** A source can be temporarily excluded without deleting its index data. */
  enabled?: boolean;
  /** Parent source id for internal rows/chunks; only the parent is shown in Data. */
  parentSourceId?: string;
  /** custom metadata fields mapped during ingestion */
  metadata?: Record<string, any>;
  /** indexing status */
  status?: 'indexed' | 'unindexed';
  createdAt: string;
}

export type MediaType = 'image' | 'video' | 'audio';

export type MediaProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed';

/** Durable stages used by the media ingestion pipeline. */
export type MediaPipelineStage =
  | 'download'
  | 'prepare'
  | 'extract'
  | 'transcribe'
  | 'vision'
  | 'synthesize'
  | 'index';

export type MediaProcessingStepStatus = 'waiting' | 'running' | 'completed' | 'skipped' | 'failed';

/**
 * Progress for one media pipeline stage.
 *
 * Counts are useful for concrete work such as frames, chunks, or bytes, while
 * `percent` supports providers that only expose a normalized estimate.
 */
export interface MediaProcessingStep {
  stage: MediaPipelineStage;
  status: MediaProcessingStepStatus;
  percent?: number;
  current?: number;
  total?: number;
  unit?: string;
  /** Runtime-supplied ETA for the remaining worker pipeline. */
  estimatedRemainingSeconds?: number;
  /** Runtime elapsed time associated with the ETA above. */
  elapsedSeconds?: number;
  /** Monotonic worker update id used to distinguish a heartbeat from a stale value. */
  sequence?: number;
  message?: string;
  startedAt?: string;
  updatedAt: string;
  finishedAt?: string;
}

export interface MediaAsset {
  id: string;
  type: MediaType;
  fileName: string;
  mimeType: string;
  storageUri: string;
  thumbnailUri?: string;
  originalUrl?: string;
  fileSize: number;
  dimensions?: { width: number; height: number };
  durationSecs?: number;
  processingStatus: MediaProcessingStatus;
  processingError?: string;
  processingProgress?: number;
  processingMessage?: string;
  processingPaused?: boolean;
  processingSteps?: MediaProcessingStep[];
  processingRevision?: number;
  /** Start time of the current processing attempt; reset on retry/re-index. */
  processingStartedAt?: string;
  processingHeartbeatAt?: string;
  caption?: string;
  documentIds: string[];
  pendingDocumentIds?: string[];
  supersededDocumentIds?: string[];
  /** Active durable Video Knowledge Engine revision, when media has been migrated. */
  activeVideoKnowledgeRevisionId?: string;
  /** Active evidence/projection manifest for the revision above. */
  activeVideoKnowledgeManifestId?: string;
  /** Current/last durable job, used for status, cancellation, and scoped retry. */
  activeVideoKnowledgeJobId?: string;
  /** Active managed Video Intelligence job, used to cancel cloud work before deletion. */
  activeVideoIntelligenceJobId?: string;
  /** Runtime that produced the active video knowledge revision. */
  videoRuntimeScope?: 'local' | 'cloud';
  indexingInstructions?: string;
  indexingQuality?: number;
  /** Marketplace-owned, JSON-serializable indexing input keyed by tool id. */
  toolInputs?: Record<string, unknown>;
  /** Group the derived searchable source belongs to. */
  groupId?: string;
  createdAt: string;
  updatedAt: string;
}

/** Links a document back to the tabular dataset it originated from. */
export interface TabularRef {
  /** ID of the TabularDataset */
  datasetId: string;
  /** Row index within the dataset */
  rowIndex: number;
  /** Mapping of column names used in the document content */
  columnMap: string[];
}

export type CrawlJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

/** Whether to scrape a single page or crawl an entire domain. */
export type CrawlScope = 'page' | 'domain';

/** One URL/domain inside a crawl job. */
export interface CrawlTarget {
  url: string;
  scope: CrawlScope;
  /** Firecrawl crawl id, once started (domain scope only) */
  firecrawlId?: string;
  status: CrawlJobStatus;
  pagesCrawled: number;
  error?: string;
}

/**
 * A durable ETL job. Designed to run for a long time: targets are polled
 * incrementally and documents are persisted as they arrive.
 */
export interface CrawlJob {
  id: string;
  keywords: string;
  targets: CrawlTarget[];
  status: CrawlJobStatus;
  /** per-domain page cap passed to Firecrawl */
  pageLimit: number;
  pagesCrawled: number;
  docCount: number;
  /** Group assigned when the job was queued; applied to every scraped source. */
  groupId?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/** A single result from a keyword web search. */
export interface SearchResultItem {
  url: string;
  title: string;
  description?: string;
}

export type IndexRunStatus =
  | 'idle'
  | 'chunking'
  | 'embedding'
  | 'upserting'
  | 'completed'
  | 'failed';

export type IndexRunStage = 'chunk' | 'embed' | 'upsert';

/**
 * Live state of an indexing run. Persisted to disk so the UI can poll progress
 * and so an interrupted run is visible after a restart. A single run at a time
 * is enough for a local toolkit.
 */
export interface IndexRun {
  id: string;
  status: IndexRunStatus;
  /** snapshot of the config used for this run */
  embeddingModelId: string;
  vectorStore: VectorStoreId;
  indexType: IndexType;
  /** total chunks produced from the corpus */
  totalChunks: number;
  /** chunks embedded + upserted so far */
  processedChunks: number;
  /** documents seen */
  docCount: number;
  /** Documents whose every chunk has reached the vector store. */
  indexedDocumentCount?: number;
  /** vector dimensions of the embeddings */
  dimensions: number;
  error?: string;
  /** Transient warning (e.g. rate-limit pause). Cleared when resolved. */
  warning?: string;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  /** ms the run took, once finished */
  durationMs?: number;
}

export type StageId = 'configure' | 'data' | 'server' | 'demo' | 'chat';

export interface StageMeta {
  id: StageId;
  label: string;
  href: string;
  description: string;
  /** phase this stage is delivered in; lets UI mark "coming soon" */
  phase: number;
}
