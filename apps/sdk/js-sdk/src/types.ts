export interface LarkupClientOptions {
  /** The URL of the Larkup Server (e.g. http://localhost:8080) */
  baseUrl?: string;
  /** The server API key, required if the server is protected */
  apiKey?: string;
}

export interface Document {
  id: string;
  text: string;
  title?: string;
  url?: string;
  documentId?: string;
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
  error?: string;
}

export interface HealthResponse {
  ok: boolean;
  service?: string;
}
