export type VectorStoreId =
  | 'lancedb'
  | 'pinecone'
  | 'weaviate'
  | 'qdrant'
  | 'chroma'
  | 'pgvector'
  | 'supabase';

/** Where a given store is able to run. */
export type StoreRuntime = 'local' | 'cloud' | 'both';

/** Primitive kinds a credential/config field can be. */
export type FieldType = 'text' | 'password' | 'path' | 'select';

export interface StoreFieldOption {
  label: string;
  value: string;
}

/**
 * A single credential/config input a vector store needs.
 * The Configuration form renders these dynamically, and the Phase 4
 * dependency resolver reads the same registry to emit the right deps.
 */
export interface StoreField {
  /** key used in the saved config object */
  key: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  required: boolean;
  /** human hint shown under the input */
  help?: string;
  /** only for type === "select" */
  options?: StoreFieldOption[];
  /** default value */
  defaultValue?: string;
  /**
   * Optional dependency: only show/require this field when another field
   * (by key) has one of these values. Powers LanceDB local-vs-cloud.
   */
  showWhen?: { key: string; equals: string[] };
  /**
   * Optional cross-concern dependency: only show/require this field when the
   * global `indexType` is one of these values. Powers Pinecone sparse model
   * field (visible only for lexical / hybrid).
   */
  showWhenIndexType?: IndexType[];
  /** mark a field as a secret that should come from an env var on the server */
  secret?: boolean;
}

export interface VectorStoreDescriptor {
  id: VectorStoreId;
  label: string;
  description: string;
  runtime: StoreRuntime;
  /** Whether this store is pre-installed, installable on demand, or coming soon */
  installStatus: 'installed' | 'installable' | 'coming-soon';
  /** npm packages the GENERATED server needs when this store is selected */
  serverDependencies: Record<string, string>;
  /** the dynamic config/credential fields */
  fields: StoreField[];
  /** docs link for the store */
  docsUrl?: string;
}

/* ------------------------------------------------------------------ */
/* Embeddings                                                          */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* Indexing / chunking                                                 */
/* ------------------------------------------------------------------ */

export type IndexType = 'lexical' | 'semantic' | 'hybrid';

export interface ChunkingParams {
  /** target chunk size in tokens */
  chunkSize: number;
  /** overlap between chunks in tokens */
  chunkOverlap: number;
  /** split strategy */
  strategy: 'recursive' | 'sentence' | 'fixed';
}

/* ------------------------------------------------------------------ */
/* The persisted toolkit config                                        */
/* ------------------------------------------------------------------ */

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
  updatedAt: string;
  deployment?: AgentDeploymentConfig;
  enabledTools?: string[];
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
  toolConfigs: {},
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
- FOR WINNER, RESULT, OR OUTCOME QUESTIONS: inspect both the semantic matches and any returned endingContext. Prefer an explicit final announcement, final scoreboard, or celebration over an earlier lead; a participant leading mid-match is not proof they won.
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

/* ------------------------------------------------------------------ */
/* Data loading / ETL (Phase 2)                                        */
/* ------------------------------------------------------------------ */

/** How a document entered the corpus. */
export type DocumentSource = 'text' | 'files' | 'website' | 'media' | 'integrations';

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
  /** custom metadata fields mapped during ingestion */
  metadata?: Record<string, any>;
  /** indexing status */
  status?: 'indexed' | 'unindexed';
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Media assets                                                        */
/* ------------------------------------------------------------------ */

export type MediaType = 'image' | 'video' | 'audio';

export type MediaProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed';

/** Durable stages used by the media ingestion pipeline. */
export type MediaPipelineStage =
  | 'download'
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
  indexingInstructions?: string;
  indexingQuality?: number;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Tabular data references                                             */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* Indexing runs (Phase 3)                                             */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* Pipeline stages (drive the sidebar nav + gating)                    */
/* ------------------------------------------------------------------ */

export type StageId = 'configure' | 'data' | 'server' | 'demo' | 'chat';

export interface StageMeta {
  id: StageId;
  label: string;
  href: string;
  description: string;
  /** phase this stage is delivered in; lets UI mark "coming soon" */
  phase: number;
}

/* ------------------------------------------------------------------ */
/* Agent Deployment Types                                              */
/* ------------------------------------------------------------------ */

export type AgentAuthMode = 'none' | 'api-key' | 'join-code';

export interface AgentWidgetStyle {
  primaryColor: string;
  position: 'bottom-right' | 'bottom-left';
  title: string;
  welcomeMessage: string;
  placeholder: string;
  avatarUrl?: string;
  darkMode: boolean;
  borderRadius: 'sm' | 'md' | 'lg' | 'full';
}

export interface AgentDeploymentConfig {
  type: 'rag-only' | 'full-agent';
  authMode: AgentAuthMode;
  joinCode?: string;
  enabledToolIds: string[];
  widgetStyle: AgentWidgetStyle;
  chatModelId?: string;
  chatProvider?: string;
  chatApiKey?: string;
  systemPrompt?: string;
  allowedOrigins: string[];
  webSearchEnabled?: boolean;
  webSearchApiKey?: string;
  webSearchProvider?: 'tavily' | 'serper' | 'google' | 'brave' | 'bing' | 'exa' | 'local';
  /** Vercel Blob token for LanceDB cloud storage */
  vercelBlobToken?: string;
}

export const DEFAULT_WIDGET_STYLE: AgentWidgetStyle = {
  primaryColor: '#000000',
  position: 'bottom-right',
  title: 'Chat with AI',
  welcomeMessage: 'Hi! How can I help you today?',
  placeholder: 'Type a message...',
  darkMode: false,
  borderRadius: 'lg',
};

export const DEFAULT_DEPLOYMENT_CONFIG: AgentDeploymentConfig = {
  type: 'rag-only',
  authMode: 'none',
  enabledToolIds: [],
  widgetStyle: DEFAULT_WIDGET_STYLE,
  allowedOrigins: ['*'],
};
