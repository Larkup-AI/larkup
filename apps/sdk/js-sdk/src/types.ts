export interface LarkupClientOptions {
  baseUrl?: string;
  apiKey?: string;
}

/** Connection options for a single deployed Larkup Agent Runtime. */
export interface LarkupAgentClientOptions {
  /** Agent Runtime URL, for example http://localhost:8083. */
  baseUrl?: string;
  /** Optional bearer token for deployments that enforce one. */
  apiKey?: string;
  /** Join code for agents protected with join-code access. */
  joinCode?: string;
}

export interface AgentChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/** Optional per-request chat settings accepted by a generated Agent Runtime. */
export interface AgentChatRequest {
  messages: AgentChatMessage[];
  /** Runtime provider. Omit to use the deployment's configured provider. */
  provider?: string;
  /** Model ID to use for this request. See `chatModels()` for supported IDs. */
  modelId?: string;
  topK?: number;
}

export interface ChatProvider {
  id: string;
  name: string;
  modelCount: number;
}

export interface ChatModel {
  id: string;
  name: string;
  /** Model vendor, for example `openai` or `anthropic`. */
  provider: string;
  contextWindow?: number;
  maxTokens?: number;
  tags?: string[];
  description?: string;
}

/** Chat choices visible to the SDK for one generated Larkup runtime. */
export interface ChatModelCatalog {
  /** Provider configured on this runtime, e.g. `vercel_ai_gateway` or `openai`. */
  configuredProvider: string;
  configuredModelId: string;
  providers: ChatProvider[];
  models: ChatModel[];
  /** `vercel-ai-gateway` when live Gateway discovery is available, otherwise `configured`. */
  source: 'vercel-ai-gateway' | 'configured';
}

export interface AgentInfo {
  name: string;
  agentId: string;
  profile?: 'agent';
  releaseId?: string;
  version?: string;
  tools?: AgentTool[];
}

/** A tool loaded by a generated Larkup Agent Server. */
export interface AgentTool {
  id: string;
  name: string;
  description: string;
  /** Whether this comes from Larkup, a sandbox, an MCP connection, or a plugin. */
  source?: 'built-in' | 'sandbox' | 'mcp' | 'plugin' | 'skill';
  /** Active means the server can execute it; configured means it is selected in the Project UI. */
  availability?: 'active' | 'configured';
  connectionId?: string;
  pluginId?: string;
}

/** A runtime capability groups related tools into one user-facing integration. */
export interface AgentCapability {
  id: string;
  name: string;
  source: NonNullable<AgentTool['source']>;
  connectionId?: string;
  pluginId?: string;
  tools: AgentTool[];
}

/** The saved Agent instructions and enabled skills available at runtime. */
export interface AgentRuntimeConfiguration {
  systemPrompt: string;
  skills: Array<{ id: string; name: string; description?: string; url?: string }>;
  enabledTools: Array<{ id: string; name: string; description: string }>;
  sandbox: { provider: string; configured: boolean; enabled: boolean };
}

/** Sanitized execution-environment status for a generated Agent Server. */
export interface AgentSandboxStatus {
  provider: string;
  configured: boolean;
  status: 'ready' | 'unavailable' | 'not_configured' | 'error' | string;
  message?: string;
  /** Present on Agent Servers generated before the normalized `message` response. */
  error?: string;
}

/** Response returned by the public Agent Runtime liveness endpoint. */
export interface AgentHealth {
  ok: boolean;
  service?: string;
  type?: 'agent-server';
  profile?: 'agent';
  /** Included by legacy deployed Agent Runtimes. */
  status?: 'ok';
  agentId?: string;
  releaseId?: string;
  version?: string;
  uptimeSeconds?: number;
}

/** OpenAPI document served by a running Agent Runtime. */
export interface AgentOpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description?: string };
  paths: Record<string, unknown>;
  [key: string]: unknown;
}

/** Input shape for using a remote Larkup agent as an AI SDK tool. */
export interface LarkupAgentToolInput {
  message: string;
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
  /** Runtime provider. Omit to use the deployment's configured provider. */
  provider?: string;
  /** Model ID to use for this request. See `chatModels()` for supported IDs. */
  modelId?: string;
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
  'media' | 'search' | 'analytics' | 'integration' | 'embedding' | 'ai' | 'automation' | 'utility';

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
  requiresSandbox?: boolean;
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

/** Seekable, source-grounded video citation returned by Video Knowledge surfaces. */
export interface VideoEvidenceCitation {
  mediaAssetId: string;
  evidenceId: string;
  startSecs: number;
  endSecs: number;
  precision: 'word' | 'segment' | 'frame' | 'estimated';
  confidence: {
    score: number;
    calibrationStatus: 'calibrated' | 'uncalibrated';
    uncertaintyReasons: string[];
  };
  conflicted?: boolean;
}

export interface VideoKnowledgeQueryRequest {
  mediaAssetId: string;
  query: string;
  limit?: number;
}

export interface VideoKnowledgeQueryResponse {
  success: boolean;
  evidence: VideoEvidenceCitation[];
  verification: {
    status: 'supported' | 'conflicted' | 'insufficient' | 'needs_inspection';
    reasons: string[];
  };
}

/** Media asset management. */

export type MediaType = 'image' | 'video' | 'audio';
export type MediaProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface MediaAsset {
  id: string;
  type: MediaType;
  fileName: string;
  mimeType: string;
  storageUri: string;
  fileSize: number;
  processingStatus: MediaProcessingStatus;
  processingProgress?: number;
  processingError?: string;
  processingMessage?: string;
  caption?: string;
  durationSecs?: number;
  dimensions?: { width: number; height: number };
  documentIds: string[];
  activeVideoKnowledgeRevisionId?: string;
  activeVideoKnowledgeManifestId?: string;
  createdAt: string;
}

export interface MediaListResponse {
  assets: MediaAsset[];
  total: number;
}

export interface MediaDeleteResponse {
  success: boolean;
}

export interface MediaJobStatus {
  id: string;
  status: string;
  checkpoint?: {
    stage: string;
    chunkIndex?: number;
    completedEvidenceIds: string[];
    completedProjectionIds: string[];
  };
  attempt: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RefinementDecisionResponse {
  job: {
    id: string;
    status: 'queued' | 'running' | 'completed' | 'failed' | 'declined' | 'expired';
    terminalReason?: string;
    error?: string;
  };
}
