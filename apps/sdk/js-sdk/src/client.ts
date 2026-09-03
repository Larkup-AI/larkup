import type {
  AddDocumentResponse,
  ChatEvent,
  ChatModel,
  ChatModelCatalog,
  ChatProvider,
  ChatRequest,
  CorpusExportFormat,
  CorpusRequest,
  CorpusResponse,
  CorpusSummary,
  Document,
  DocumentInput,
  HealthResponse,
  IndexDocumentsOptions,
  IndexProgressEvent,
  LarkupClientOptions,
  MediaAsset,
  MediaDeleteResponse,
  MediaJobStatus,
  MediaListResponse,
  MutationResponse,
  PaginatedDocuments,
  QueryRequest,
  QueryResponse,
  RefinementDecisionResponse,
  ScrapeResponse,
} from './types';

export class LarkupApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(`Larkup API Error (${status}): ${message}`);
    this.name = 'LarkupApiError';
    this.status = status;
  }
}

async function errorFor(response: Response): Promise<LarkupApiError> {
  let message = response.statusText;
  try {
    const body = (await response.json()) as { error?: string };
    message = body.error || message;
  } catch {}
  return new LarkupApiError(response.status, message);
}

/** Client for a generated Larkup Knowledge Server. */
export class LarkupClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor(options: LarkupClientOptions = {}) {
    this.baseUrl = (
      options.baseUrl ??
      process.env.LARKUP_API_URL ??
      'http://localhost:8080'
    ).replace(/\/+$/, '');
    this.apiKey = options.apiKey ?? process.env.LARKUP_API_KEY;
  }

  private headers(input?: HeadersInit): Headers {
    const headers = new Headers(input);
    if (this.apiKey) headers.set('Authorization', `Bearer ${this.apiKey}`);
    return headers;
  }

  private async request(path: string, options: RequestInit = {}): Promise<Response> {
    const headers = this.headers(options.headers);
    if (options.body !== undefined && !(options.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }
    const response = await fetch(`${this.baseUrl}${path}`, { ...options, headers });
    if (!response.ok) throw await errorFor(response);
    return response;
  }

  private async json<T>(path: string, options: RequestInit = {}): Promise<T> {
    return (await this.request(path, options)).json() as Promise<T>;
  }

  /** Returns the deployed Knowledge Server health and service name. */
  health(): Promise<HealthResponse> {
    return this.json('/health');
  }

  /** Checks that the Knowledge Server can reach its vector store. */
  readiness(): Promise<{
    ready: boolean;
    vectorStore: string;
    documents?: number;
    error?: string;
  }> {
    return this.json('/readiness');
  }

  /** Returns the generated OpenAPI schema. */
  openApi(): Promise<Record<string, unknown>> {
    return this.json('/openapi.json');
  }

  /** List all chat providers and models available to this deployment. */
  chatModelCatalog(provider?: string): Promise<ChatModelCatalog> {
    const query = provider ? `?provider=${encodeURIComponent(provider)}` : '';
    return this.json(`/models${query}`);
  }

  /** List available chat model vendors. */
  async chatProviders(): Promise<ChatProvider[]> {
    return (await this.chatModelCatalog()).providers;
  }

  /** List available chat models, optionally filtered by their vendor. */
  async chatModels(provider?: string): Promise<ChatModel[]> {
    return (await this.chatModelCatalog(provider)).models;
  }

  /** Runs semantic retrieval against the server's configured index. */
  query(request: QueryRequest | string, topK?: number): Promise<QueryResponse> {
    const body = typeof request === 'string' ? { query: request, topK } : request;
    return this.json('/query', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  /** Lists indexed document chunks with server-side pagination. */
  listDocuments(page = 1, limit = 20): Promise<PaginatedDocuments> {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
    });
    return this.json(`/documents?${params}`);
  }

  /** Returns one indexed document chunk. */
  getDocument(id: string): Promise<Document> {
    return this.json(`/documents/${encodeURIComponent(id)}`);
  }

  /** Embeds and stores one document. */
  addDocument(document: DocumentInput): Promise<AddDocumentResponse> {
    return this.json('/documents', {
      method: 'POST',
      body: JSON.stringify(document),
    });
  }

  /** Re-embeds and replaces one document. */
  updateDocument(id: string, document: Omit<DocumentInput, 'id'>): Promise<MutationResponse> {
    return this.json(`/documents/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(document),
    });
  }

  /** Removes one document from the index. */
  deleteDocument(id: string): Promise<MutationResponse> {
    return this.json(`/documents/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  /** Scrapes a URL, chunks its text, and indexes the chunks. */
  scrape(url: string): Promise<ScrapeResponse> {
    return this.json('/scrape', {
      method: 'POST',
      body: JSON.stringify({ url }),
    });
  }

  /** Returns aggregate statistics for the indexed corpus. */
  corpusSummary(): Promise<CorpusSummary> {
    return this.json('/corpus/summary');
  }

  /** Returns a filtered window of the indexed corpus. */
  corpus(request: CorpusRequest = {}): Promise<CorpusResponse> {
    return this.json('/corpus', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  /** Exports the indexed corpus as CSV or JSONL text. */
  async exportCorpus(format: CorpusExportFormat = 'csv'): Promise<string> {
    const response = await this.request('/corpus/export', {
      method: 'POST',
      body: JSON.stringify({ format }),
    });
    return response.text();
  }

  /** Streams completion events while documents are embedded and stored. */
  async *indexDocuments(
    documents: readonly DocumentInput[],
    options: IndexDocumentsOptions = {},
  ): AsyncGenerator<IndexProgressEvent> {
    const total = documents.length;
    const requestedConcurrency = options.mode === 'parallel' ? (options.concurrency ?? 4) : 1;
    const concurrency = Math.max(1, Math.min(requestedConcurrency, Math.max(total, 1)));
    const pending = new Map<
      number,
      Promise<{
        index: number;
        result?: AddDocumentResponse;
        error?: unknown;
      }>
    >();
    let cursor = 0;
    let completed = 0;
    let succeeded = 0;
    let failed = 0;

    const start = (index: number) => {
      const task = this.addDocument(documents[index])
        .then((result) => ({ index, result }))
        .catch((error: unknown) => ({ index, error }));
      pending.set(index, task);
    };

    while (cursor < total || pending.size > 0) {
      while (cursor < total && pending.size < concurrency) {
        start(cursor);
        cursor += 1;
      }

      const outcome = await Promise.race(pending.values());
      pending.delete(outcome.index);
      completed += 1;
      const error =
        outcome.error instanceof Error
          ? outcome.error.message
          : outcome.error === undefined
            ? undefined
            : String(outcome.error);

      if (error) failed += 1;
      else succeeded += 1;

      yield {
        type: 'progress',
        completed,
        total,
        succeeded,
        failed,
        percent: total === 0 ? 100 : Math.round((completed / total) * 100),
        document: documents[outcome.index],
        id: outcome.result?.id,
        error,
      };

      if (error && options.continueOnError !== true) {
        throw outcome.error;
      }
    }

    yield {
      type: 'complete',
      completed,
      total,
      succeeded,
      failed,
      percent: 100,
    };
  }

  /** Streams a retrieval-grounded chat response. */
  async *chat(request: ChatRequest | string): AsyncGenerator<ChatEvent> {
    const body =
      typeof request === 'string'
        ? { messages: [{ role: 'user' as const, content: request }] }
        : request;
    const response = await this.request('/chat', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!response.body) return;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let boundary = buffer.indexOf('\n\n');

      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf('\n\n');
        const data = frame
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('\n');
        if (!data) continue;
        try {
          const event = JSON.parse(data) as ChatEvent | string;
          yield typeof event === 'string' ? { type: 'text-delta', text: event } : event;
        } catch {
          yield { type: 'text-delta', text: data };
        }
      }

      if (done) break;
    }
  }

  /** Collects a streamed chat response into one string. */
  async chatText(request: ChatRequest | string): Promise<string> {
    let text = '';
    for await (const event of this.chat(request)) {
      if (event.type === 'error') throw new Error(event.error || 'Chat request failed.');
      text += event.text || '';
    }
    return text;
  }

  /*
   * Media assets.
   *
   * These live on the dashboard's API (`http://localhost:4567/api` by default),
   * not on a generated Knowledge Server: indexing media needs the workspace,
   * ffmpeg, and the media store, none of which a deployed server carries. Point
   * `baseUrl` at the dashboard to use them:
   *
   *   new LarkupClient({ baseUrl: 'http://localhost:4567/api' })
   */

  /** Lists all media assets (images, videos, audio). */
  async listMedia(): Promise<MediaListResponse> {
    const response = await this.request('/media');
    if (!response.ok) throw await errorFor(response);
    return (await response.json()) as MediaListResponse;
  }

  /** Fetches a single media asset by ID. */
  async getMedia(id: string): Promise<MediaAsset> {
    const response = await this.request(`/media/${encodeURIComponent(id)}`);
    if (!response.ok) throw await errorFor(response);
    return (await response.json()) as MediaAsset;
  }

  /** Deletes a media asset and its associated video knowledge data. */
  async deleteMedia(id: string): Promise<MediaDeleteResponse> {
    const response = await this.request(`/media/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw await errorFor(response);
    return (await response.json()) as MediaDeleteResponse;
  }

  /** Checks the status of a video knowledge processing job. */
  async getMediaJobStatus(jobId: string): Promise<MediaJobStatus> {
    const response = await this.request(`/media/jobs/${encodeURIComponent(jobId)}`);
    if (!response.ok) throw await errorFor(response);
    return (await response.json()) as MediaJobStatus;
  }

  /** Approves a pending background refinement job. */
  async approveRefinement(jobId: string): Promise<RefinementDecisionResponse> {
    const response = await this.request(`/media/jobs/${encodeURIComponent(jobId)}/approval`, {
      method: 'POST',
      body: JSON.stringify({ decision: 'approve' }),
    });
    if (!response.ok) throw await errorFor(response);
    return (await response.json()) as RefinementDecisionResponse;
  }

  /** Declines a pending background refinement job. */
  async declineRefinement(jobId: string): Promise<RefinementDecisionResponse> {
    const response = await this.request(`/media/jobs/${encodeURIComponent(jobId)}/approval`, {
      method: 'POST',
      body: JSON.stringify({ decision: 'decline' }),
    });
    if (!response.ok) throw await errorFor(response);
    return (await response.json()) as RefinementDecisionResponse;
  }
}
