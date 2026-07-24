import {
  LarkupClientOptions,
  QueryRequest,
  QueryResponse,
  Document,
  PaginatedDocuments,
  ScrapeResponse,
  HealthResponse,
  ChatEvent,
  ChatRequest,
} from "./types";

export class LarkupClient {
  private baseUrl: string;
  private apiKey?: string;

  constructor(options: LarkupClientOptions = {}) {
    this.baseUrl = (
      options.baseUrl ??
      process.env.LARKUP_API_URL ??
      "http://localhost:8080"
    ).replace(/\/$/, "");
    this.apiKey = options.apiKey ?? process.env.LARKUP_API_KEY;
  }

  private async fetchApi<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers = new Headers(options.headers || {});

    if (this.apiKey) {
      headers.set("Authorization", `Bearer ${this.apiKey}`);
    }

    if (!(options.body instanceof FormData)) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(url, { ...options, headers });

    if (!response.ok) {
      let errorMsg = response.statusText;
      try {
        const errBody = await response.json();
        if (errBody.error) {
          errorMsg = errBody.error;
        }
      } catch {
        // ignore JSON parse error for error bodies
      }
      throw new Error(`Larkup API Error (${response.status}): ${errorMsg}`);
    }

    return response.json();
  }

  /**
   * Health check
   */
  async health(): Promise<HealthResponse> {
    return this.fetchApi<HealthResponse>("/health");
  }

  /**
   * Query the RAG knowledge base
   */
  async query(
    request: QueryRequest | string,
    topK?: number,
  ): Promise<QueryResponse> {
    const body: QueryRequest =
      typeof request === "string" ? { query: request, topK } : request;

    return this.fetchApi<QueryResponse>("/query", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  /**
   * List documents with pagination
   */
  async listDocuments(
    page: number = 1,
    limit: number = 20,
  ): Promise<PaginatedDocuments> {
    return this.fetchApi<PaginatedDocuments>(
      `/documents?page=${page}&limit=${limit}`,
    );
  }

  /**
   * Get a specific document by ID
   */
  async getDocument(id: string): Promise<Document> {
    return this.fetchApi<Document>(`/documents/${id}`);
  }

  /**
   * Add a new document to the vector store
   */
  async addDocument(
    document: Omit<Document, "id"> & { id?: string },
  ): Promise<{ success: boolean; id: string }> {
    return this.fetchApi<{ success: boolean; id: string }>("/documents", {
      method: "POST",
      body: JSON.stringify(document),
    });
  }

  /**
   * Update an existing document
   */
  async updateDocument(
    id: string,
    document: Omit<Document, "id">,
  ): Promise<{ success: boolean }> {
    return this.fetchApi<{ success: boolean }>(`/documents/${id}`, {
      method: "PUT",
      body: JSON.stringify(document),
    });
  }

  /**
   * Delete a document
   */
  async deleteDocument(id: string): Promise<{ success: boolean }> {
    return this.fetchApi<{ success: boolean }>(`/documents/${id}`, {
      method: "DELETE",
    });
  }

  /**
   * Scrape a URL and add it to the corpus
   */
  async scrape(url: string): Promise<ScrapeResponse> {
    return this.fetchApi<ScrapeResponse>("/scrape", {
      method: "POST",
      body: JSON.stringify({ url }),
    });
  }

  /** Stream a retrieval-grounded chat response from the deployed server. */
  async *chat(request: ChatRequest | string): AsyncGenerator<ChatEvent> {
    const body: ChatRequest =
      typeof request === "string"
        ? { messages: [{ role: "user", content: request }] }
        : request;
    const headers = new Headers({ "Content-Type": "application/json" });
    if (this.apiKey) headers.set("Authorization", `Bearer ${this.apiKey}`);

    const response = await fetch(`${this.baseUrl}/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      let message = response.statusText;
      try {
        message = (await response.json()).error || message;
      } catch {}
      throw new Error(`Larkup API Error (${response.status}): ${message}`);
    }
    if (!response.body) return;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n");
        if (!data) continue;
        try {
          const event = JSON.parse(data) as ChatEvent | string;
          yield typeof event === "string" ? { type: "text-delta", text: event } : event;
        } catch {
          yield { type: "text-delta", text: data };
        }
      }
      if (done) break;
    }
  }

  /** Collect a streamed chat response into a single string. */
  async chatText(request: ChatRequest | string): Promise<string> {
    let text = "";
    for await (const event of this.chat(request)) {
      if (event.type === "error") throw new Error(event.error || "Chat request failed.");
      text += event.text || "";
    }
    return text;
  }
}
