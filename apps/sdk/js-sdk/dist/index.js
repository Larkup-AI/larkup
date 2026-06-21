// src/client.ts
var LarkupRAGClient = class {
  baseUrl;
  apiKey;
  constructor(options = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.LARKUP_RAG_API_URL ?? "http://localhost:8080").replace(/\/$/, "");
    this.apiKey = options.apiKey ?? process.env.LARKUP_RAG_API_KEY;
  }
  async fetchApi(path, options = {}) {
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
      }
      throw new Error(`LarkupRAG API Error (${response.status}): ${errorMsg}`);
    }
    return response.json();
  }
  /**
   * Health check
   */
  async health() {
    return this.fetchApi("/health");
  }
  /**
   * Query the RAG knowledge base
   */
  async query(request, topK) {
    const body = typeof request === "string" ? { query: request, topK } : request;
    return this.fetchApi("/query", {
      method: "POST",
      body: JSON.stringify(body)
    });
  }
  /**
   * List documents with pagination
   */
  async listDocuments(page = 1, limit = 20) {
    return this.fetchApi(
      `/documents?page=${page}&limit=${limit}`
    );
  }
  /**
   * Get a specific document by ID
   */
  async getDocument(id) {
    return this.fetchApi(`/documents/${id}`);
  }
  /**
   * Add a new document to the vector store
   */
  async addDocument(document) {
    return this.fetchApi("/documents", {
      method: "POST",
      body: JSON.stringify(document)
    });
  }
  /**
   * Update an existing document
   */
  async updateDocument(id, document) {
    return this.fetchApi(`/documents/${id}`, {
      method: "PUT",
      body: JSON.stringify(document)
    });
  }
  /**
   * Delete a document
   */
  async deleteDocument(id) {
    return this.fetchApi(`/documents/${id}`, {
      method: "DELETE"
    });
  }
  /**
   * Scrape a URL and add it to the corpus
   */
  async scrape(url) {
    return this.fetchApi("/scrape", {
      method: "POST",
      body: JSON.stringify({ url })
    });
  }
};
export {
  LarkupRAGClient
};
