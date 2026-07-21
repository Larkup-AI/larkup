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
  chatSuggestions?: string[];
  systemPrompt?: string;
  serperApiKey?: string;
  webSearchEnabled?: boolean;
  webSearchProvider?: 'tavily' | 'serper' | 'google' | 'brave' | 'bing' | 'local';
  tavilyApiKey?: string;
  googleApiKey?: string;
  braveApiKey?: string;
  bingApiKey?: string;
  scraperProxyServer?: string;
  scraperProxyUsername?: string;
  scraperProxyPassword?: string;
  firecrawlApiKey?: string;
  updatedAt: string;
  deployment?: AgentDeploymentConfig;
  enabledTools?: string[];
}

export const DEFAULT_CONFIG: RagConfig = {
  projectName: 'my-rag',
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
  scraperProxyServer: '',
  scraperProxyUsername: '',
  scraperProxyPassword: '',
  firecrawlApiKey: '',
  updatedAt: new Date(0).toISOString(),
};

/* ------------------------------------------------------------------ */
/* Data loading / ETL (Phase 2)                                        */
/* ------------------------------------------------------------------ */

/** How a document entered the corpus. */
export type DocumentSource = 'paste' | 'upload' | 'scrape' | 'tabular' | 'media';

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

/**
 * A media file in the corpus. Images, video, and audio are stored as
 * MediaAssets and processed into SourceDocuments (via captioning /
 * transcription) for indexing.
 */
export interface MediaAsset {
  id: string;
  type: MediaType;
  fileName: string;
  mimeType: string;
  /** Storage URI (e.g. "local://images/abc.png" or future "s3://...") */
  storageUri: string;
  thumbnailUri?: string;
  /** Original URL if imported from web */
  originalUrl?: string;
  /** File size in bytes */
  fileSize: number;
  /** Image/video dimensions */
  dimensions?: { width: number; height: number };
  /** Video/audio duration in seconds */
  durationSecs?: number;
  /** Processing status */
  processingStatus: MediaProcessingStatus;
  processingError?: string;
  /** Generated caption or transcript summary */
  caption?: string;
  /** IDs of SourceDocuments generated from this asset */
  documentIds: string[];
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
  webSearchProvider?: 'tavily' | 'serper' | 'google' | 'brave' | 'bing' | 'local';
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
