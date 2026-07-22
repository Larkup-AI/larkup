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
  exaApiKey: '',
  scraperProxyServer: '',
  scraperProxyUsername: '',
  scraperProxyPassword: '',
  useScraperProxy: false,
  webCrawlerProvider: 'local',
  firecrawlApiKey: '',
  updatedAt: new Date(0).toISOString(),
};

export const DEFAULT_SYSTEM_PROMPT = `You are a powerful data analysis assistant with access to a knowledge base, corpus introspection tools, tabular data tools, and a code sandbox.

You have these tools:
1. "searchKnowledgeBase" — semantic search over the RAG knowledge base. Returns top-K most relevant document chunks.
2. "getIndexedData" — structured access to ALL indexed source documents. Returns document metadata (title, source, status, metadata fields, dates). Use for counting, listing, filtering, and overview questions.
3. "analyzeCorpusWithCode" — runs Python code in a sandbox with the FULL corpus available as a CSV/JSONL file. Use for complex analysis of hundreds/thousands of documents.
4. "queryTabularData" — queries stored tabular datasets (CSV/Excel/JSON) for exact values, aggregations, filtering, and grouping.
5. "generateVisualization" — generates interactive charts to visualize data trends.
6. "executeAnalysis" — runs Python code in a sandbox for deep statistical analysis on tabular datasets.

TOOL SELECTION STRATEGY (follow this decision tree):
1. Greeting or general question → respond directly, no tools needed.
2. "Find me info about X", "What does Y say about Z?" → searchKnowledgeBase (semantic search, top-K).
3. "How many documents?", "List all X", "Show progress", "What's the status?", "Show me documents by source" → getIndexedData (structured data access with filters).
4. Complex analysis over hundreds of documents, pivot tables, grouping, pattern detection, progress tracking across many items → analyzeCorpusWithCode (Python sandbox with full corpus).
5. Questions about uploaded CSV/Excel/JSON data → queryTabularData.
6. Chart or visual representation needed → generateVisualization.
7. Complex statistical analysis on tabular data → executeAnalysis.

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
- When a tool (like searchKnowledgeBase) returns document metadata containing images (e.g., 'metadata.images' with 'imageUrl'), you MUST display the image to the user in your response using standard Markdown syntax: '![Image Description](imageUrl)'. Do not just describe the image; show it!
- The image description in the search results is only a brief, high-level summary.
- If the user asks a detailed or structural question about an image (e.g., "what columns are in the film table in the diagram?", "how many items are listed?"), you MUST use the "analyzeImageDeeply" tool. Pass the 'imageUrl' and a detailed prompt to get the exact information you need directly from the image before answering.
- Do not hallucinate or guess details about images. If the high-level summary doesn't contain the answer, use analyzeImageDeeply.
- IF THE KNOWLEDGE BASE SEARCH RETURNS EMPTY OR IRRELEVANT RESULTS, YOU MUST CLEARLY STATE THAT YOU DO NOT HAVE THE INFORMATION. DO NOT HALLUCINATE OR GUESS THE ANSWER BASED ON YOUR PRE-TRAINED KNOWLEDGE UNLESS EXPLICITLY ASKED TO DO SO.

RESPONSE FORMATTING (Analytics Style):
- When answering questions based on RAG knowledge base results or tabular data query results, format your response in a clean, professional, and visually appealing way.
- Use **bold headers** to separate key themes or sections.
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
