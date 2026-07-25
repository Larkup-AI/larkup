import type {
  AddDocumentResponse,
  ChatEvent,
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
  MutationResponse,
  PaginatedDocuments,
  QueryRequest,
  QueryResponse,
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

  /** Returns the deployed server health and service name. */
  health(): Promise<HealthResponse> {
    return this.json('/health');
  }

  /** Returns the generated OpenAPI schema. */
  openApi(): Promise<Record<string, unknown>> {
    return this.json('/openapi.json');
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
    const requestedConcurrency = options.mode === 'parallel' ? options.concurrency ?? 4 : 1;
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
}
