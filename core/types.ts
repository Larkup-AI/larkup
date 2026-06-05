/**
 * Shared contracts for the RAG Toolkit.
 *
 * These types are the single source of truth used by BOTH:
 *  - the Web UI + CLI (the heavyweight local "toolkit")
 *  - the lightweight generated RAG server (Phase 4)
 *
 * Keeping them framework-agnostic (no React / Next imports) means the
 * generated server can import the same contracts without dragging in UI deps.
 */

/* ------------------------------------------------------------------ */
/* Vector stores                                                       */
/* ------------------------------------------------------------------ */

export type VectorStoreId = "lancedb" | "pinecone"

/** Where a given store is able to run. */
export type StoreRuntime = "local" | "cloud" | "both"

/** Primitive kinds a credential/config field can be. */
export type FieldType = "text" | "password" | "path" | "select"

export interface StoreFieldOption {
  label: string
  value: string
}

/**
 * A single credential/config input a vector store needs.
 * The Configuration form renders these dynamically, and the Phase 4
 * dependency resolver reads the same registry to emit the right deps.
 */
export interface StoreField {
  /** key used in the saved config object */
  key: string
  label: string
  type: FieldType
  placeholder?: string
  required: boolean
  /** human hint shown under the input */
  help?: string
  /** only for type === "select" */
  options?: StoreFieldOption[]
  /** default value */
  defaultValue?: string
  /**
   * Optional dependency: only show/require this field when another field
   * (by key) has one of these values. Powers LanceDB local-vs-cloud.
   */
  showWhen?: { key: string; equals: string[] }
  /**
   * Optional cross-concern dependency: only show/require this field when the
   * global `indexType` is one of these values. Powers Pinecone sparse model
   * field (visible only for lexical / hybrid).
   */
  showWhenIndexType?: IndexType[]
  /** mark a field as a secret that should come from an env var on the server */
  secret?: boolean
}

export interface VectorStoreDescriptor {
  id: VectorStoreId
  label: string
  description: string
  runtime: StoreRuntime
  /** npm packages the GENERATED server needs when this store is selected */
  serverDependencies: Record<string, string>
  /** the dynamic config/credential fields */
  fields: StoreField[]
  /** docs link for the store */
  docsUrl?: string
}

/* ------------------------------------------------------------------ */
/* Embeddings                                                          */
/* ------------------------------------------------------------------ */

export type EmbeddingProvider = "openai" | "google" | "cohere"

export interface EmbeddingModelDescriptor {
  id: string
  label: string
  provider: EmbeddingProvider
  /** output vector dimensions */
  dimensions: number
  /** max input tokens per request */
  maxInputTokens: number
  description: string
}

/* ------------------------------------------------------------------ */
/* Indexing / chunking                                                 */
/* ------------------------------------------------------------------ */

export type IndexType = "lexical" | "semantic" | "hybrid"

export interface ChunkingParams {
  /** target chunk size in tokens */
  chunkSize: number
  /** overlap between chunks in tokens */
  chunkOverlap: number
  /** split strategy */
  strategy: "recursive" | "sentence" | "fixed"
}

/* ------------------------------------------------------------------ */
/* The persisted toolkit config                                        */
/* ------------------------------------------------------------------ */

export interface RagConfig {
  /** project label, used when generating the server */
  projectName: string
  embeddingModelId: string
  indexType: IndexType
  chunking: ChunkingParams
  vectorStore: VectorStoreId
  /** dynamic, store-specific values keyed by StoreField.key */
  storeConfig: Record<string, string>
  /** topK default used by the generated server + demo */
  topK: number
  updatedAt: string
}

export const DEFAULT_CONFIG: RagConfig = {
  projectName: "my-rag",
  embeddingModelId: "openai/text-embedding-3-small",
  indexType: "hybrid",
  chunking: {
    chunkSize: 512,
    chunkOverlap: 64,
    strategy: "recursive",
  },
  vectorStore: "lancedb",
  storeConfig: {
    mode: "local",
    dbPath: "./.ragtoolkit/lancedb",
  },
  topK: 5,
  updatedAt: new Date(0).toISOString(),
}

/* ------------------------------------------------------------------ */
/* Data loading / ETL (Phase 2)                                        */
/* ------------------------------------------------------------------ */

/** How a document entered the corpus. */
export type DocumentSource = "paste" | "upload" | "scrape"

/**
 * A single cleaned document in the corpus. This is the unit that Phase 3
 * chunks + embeds. Stored locally as the ETL runs so nothing is lost if a
 * long crawl is interrupted.
 */
export interface SourceDocument {
  id: string
  title: string
  /** origin URL for scraped/uploaded-from-web docs */
  url?: string
  source: DocumentSource
  /** cleaned markdown / plain text */
  content: string
  charCount: number
  /** crawl job that produced this doc, if any */
  jobId?: string
  createdAt: string
}

export type CrawlJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"

/** Whether to scrape a single page or crawl an entire domain. */
export type CrawlScope = "page" | "domain"

/** One URL/domain inside a crawl job. */
export interface CrawlTarget {
  url: string
  scope: CrawlScope
  /** Firecrawl crawl id, once started (domain scope only) */
  firecrawlId?: string
  status: CrawlJobStatus
  pagesCrawled: number
  error?: string
}

/**
 * A durable ETL job. Designed to run for a long time: targets are polled
 * incrementally and documents are persisted as they arrive.
 */
export interface CrawlJob {
  id: string
  keywords: string
  targets: CrawlTarget[]
  status: CrawlJobStatus
  /** per-domain page cap passed to Firecrawl */
  pageLimit: number
  pagesCrawled: number
  docCount: number
  error?: string
  createdAt: string
  updatedAt: string
}

/** A single result from a keyword web search. */
export interface SearchResultItem {
  url: string
  title: string
  description?: string
}

/* ------------------------------------------------------------------ */
/* Indexing runs (Phase 3)                                             */
/* ------------------------------------------------------------------ */

export type IndexRunStatus =
  | "idle"
  | "chunking"
  | "embedding"
  | "upserting"
  | "completed"
  | "failed"

export type IndexRunStage = "chunk" | "embed" | "upsert"

/**
 * Live state of an indexing run. Persisted to disk so the UI can poll progress
 * and so an interrupted run is visible after a restart. A single run at a time
 * is enough for a local toolkit.
 */
export interface IndexRun {
  id: string
  status: IndexRunStatus
  /** snapshot of the config used for this run */
  embeddingModelId: string
  vectorStore: VectorStoreId
  indexType: IndexType
  /** total chunks produced from the corpus */
  totalChunks: number
  /** chunks embedded + upserted so far */
  processedChunks: number
  /** documents seen */
  docCount: number
  /** vector dimensions of the embeddings */
  dimensions: number
  error?: string
  startedAt: string
  updatedAt: string
  finishedAt?: string
  /** ms the run took, once finished */
  durationMs?: number
}

/* ------------------------------------------------------------------ */
/* Pipeline stages (drive the sidebar nav + gating)                    */
/* ------------------------------------------------------------------ */

export type StageId = "configure" | "data" | "index" | "server" | "demo"

export interface StageMeta {
  id: StageId
  label: string
  href: string
  description: string
  /** phase this stage is delivered in; lets UI mark "coming soon" */
  phase: number
}
