interface LarkupRAGClientOptions {
    /** The URL of the Larkup RAG Server (e.g. http://localhost:8080) */
    baseUrl?: string;
    /** The server API key, required if the server is protected */
    apiKey?: string;
}
interface Document {
    id: string;
    text: string;
    title?: string;
    url?: string;
    documentId?: string;
}
interface QueryRequest {
    query: string;
    topK?: number;
}
interface QueryHit {
    id: string;
    score: number;
    text: string;
    title: string;
    url?: string;
    documentId: string;
}
interface QueryResponse {
    query: string;
    hits: QueryHit[];
}
interface PaginatedDocuments {
    documents: Document[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}
interface ScrapeRequest {
    url: string;
}
interface ScrapeResponse {
    success: boolean;
    documentId?: string;
    error?: string;
}
interface HealthResponse {
    ok: boolean;
    service?: string;
}

declare class LarkupRAGClient {
    private baseUrl;
    private apiKey?;
    constructor(options?: LarkupRAGClientOptions);
    private fetchApi;
    /**
     * Health check
     */
    health(): Promise<HealthResponse>;
    /**
     * Query the RAG knowledge base
     */
    query(request: QueryRequest | string, topK?: number): Promise<QueryResponse>;
    /**
     * List documents with pagination
     */
    listDocuments(page?: number, limit?: number): Promise<PaginatedDocuments>;
    /**
     * Get a specific document by ID
     */
    getDocument(id: string): Promise<Document>;
    /**
     * Add a new document to the vector store
     */
    addDocument(document: Omit<Document, "id"> & {
        id?: string;
    }): Promise<{
        success: boolean;
        id: string;
    }>;
    /**
     * Update an existing document
     */
    updateDocument(id: string, document: Omit<Document, "id">): Promise<{
        success: boolean;
    }>;
    /**
     * Delete a document
     */
    deleteDocument(id: string): Promise<{
        success: boolean;
    }>;
    /**
     * Scrape a URL and add it to the corpus
     */
    scrape(url: string): Promise<ScrapeResponse>;
}

export { type Document, type HealthResponse, LarkupRAGClient, type LarkupRAGClientOptions, type PaginatedDocuments, type QueryHit, type QueryRequest, type QueryResponse, type ScrapeRequest, type ScrapeResponse };
