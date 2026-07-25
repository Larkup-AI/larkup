export interface LarkupClientOptions {
  baseUrl?: string;
  apiKey?: string;
}

export interface Document {
  id: string;
  text: string;
  title?: string;
  url?: string;
  documentId?: string;
}

export type DocumentInput = Omit<Document, 'id'> & { id?: string };

export interface MutationResponse {
  success: boolean;
}

export interface AddDocumentResponse extends MutationResponse {
  id: string;
}

export interface QueryRequest {
  query: string;
  topK?: number;
}

export interface QueryHit {
  id: string;
  score: number;
  text: string;
  title: string;
  url?: string;
  documentId: string;
  metadata?: Record<string, unknown>;
}

export interface QueryResponse {
  query: string;
  hits: QueryHit[];
}

export interface PaginatedDocuments {
  documents: Document[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ScrapeRequest {
  url: string;
}

export interface ScrapeResponse {
  success: boolean;
  documentId?: string;
  chunks?: number;
  error?: string;
}

export interface HealthResponse {
  ok: boolean;
  service?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  topK?: number;
}

export interface ChatEvent {
  type: 'text-delta' | 'done' | 'error';
  text?: string;
  hits?: QueryHit[];
  error?: string;
}

export interface CorpusSummary {
  totalDocuments: number;
  bySource: Record<string, number>;
  byStatus: Record<string, number>;
  totalCharacters: number;
}

export interface CorpusFilter {
  source?: string;
  titleContains?: string;
}

export interface CorpusRequest {
  filter?: CorpusFilter;
  limit?: number;
  offset?: number;
  includeContent?: boolean;
}

export interface CorpusDocument {
  id: string;
  title?: string;
  url?: string;
  documentId?: string;
  charCount: number;
  content?: string;
}

export interface CorpusResponse {
  documents: CorpusDocument[];
  total: number;
  page: number;
  limit: number;
}

export type CorpusExportFormat = 'csv' | 'jsonl';
export type IndexingMode = 'sequential' | 'parallel';

export interface IndexDocumentsOptions {
  mode?: IndexingMode;
  concurrency?: number;
  continueOnError?: boolean;
}

export interface IndexProgressEvent {
  type: 'progress' | 'complete';
  completed: number;
  total: number;
  succeeded: number;
  failed: number;
  percent: number;
  document?: DocumentInput;
  id?: string;
  error?: string;
}

export type ToolCategory =
  | 'media'
  | 'search'
  | 'analytics'
  | 'integration'
  | 'embedding'
  | 'ai'
  | 'automation'
  | 'utility';

export type ToolPricing = 'free' | 'pro' | 'enterprise';

export interface ToolConfigField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'select' | 'toggle';
  defaultValue?: string;
  help?: string;
  required?: boolean;
  options?: Array<{ label: string; value: string }>;
}

export interface MarketplaceTool {
  id: string;
  name: string;
  description: string;
  longDescription?: string;
  category: ToolCategory;
  version: string;
  pricing: ToolPricing;
  emoji?: string;
  iconUrl?: string;
  icon: string;
  packageName: string;
  installSize: string;
  systemDeps?: string[];
  author: string;
  capabilities: string[];
  configSchema?: ToolConfigField[];
  tags?: string[];
  downloads: number;
  repositoryUrl?: string;
  license?: string;
  changelog?: string;
  minLarkupVersion?: string;
  updatedAt?: string;
  comingSoon?: boolean;
}

export interface ListToolsRequest {
  category?: ToolCategory;
  search?: string;
  page?: number;
  limit?: number;
}

export interface ToolListResponse {
  tools: MarketplaceTool[];
  total: number;
}

export interface ToolDetailResponse {
  tool: MarketplaceTool;
  installs: number;
  versions: Array<{ version: string; publishedAt: string }>;
}

export interface LarkupHubClientOptions {
  baseUrl?: string;
  apiKey?: string;
}
