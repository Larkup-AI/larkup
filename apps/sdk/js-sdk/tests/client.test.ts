import { describe, it, expect, vi, beforeEach } from "vitest";
import { LarkupClient } from "../src/client";

// Mock global fetch
const fetchMock = vi.fn();
global.fetch = fetchMock;

function ok(body: unknown) {
  return { ok: true, json: async () => body, status: 200, statusText: "OK" };
}

function err(status: number, body: unknown) {
  return {
    ok: false,
    status,
    statusText: "Error",
    json: async () => body,
  };
}

function sse(chunks: string[]) {
  const encoder = new TextEncoder();
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
  };
}

describe("LarkupClient", () => {
  let client: LarkupClient;

  beforeEach(() => {
    fetchMock.mockClear();
    client = new LarkupClient({
      baseUrl: "http://test.local:8080",
      apiKey: "test-key-123",
    });
  });

  // ── Auth ─────────────────────────────────────────────────────────────────
  it("should include Authorization header when apiKey is set", async () => {
    fetchMock.mockResolvedValueOnce(ok({ ok: true }));
    await client.health();

    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer test-key-123");
  });

  it("should not include Authorization when no apiKey", async () => {
    const noAuth = new LarkupClient({ baseUrl: "http://test.local:8080" });
    fetchMock.mockResolvedValueOnce(ok({ ok: true }));
    await noAuth.health();

    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Headers;
    expect(headers.has("Authorization")).toBe(false);
  });

  // ── Health ───────────────────────────────────────────────────────────────
  it("health() returns ok", async () => {
    fetchMock.mockResolvedValueOnce(ok({ ok: true, service: "my-rag" }));
    const res = await client.health();
    expect(res.ok).toBe(true);
    expect(res.service).toBe("my-rag");
  });

  // ── Query ────────────────────────────────────────────────────────────────
  it("query() with string shorthand", async () => {
    fetchMock.mockResolvedValueOnce(
      ok({ query: "hello", hits: [{ id: "1", score: 0.9, text: "world", title: "t", documentId: "d1" }] })
    );
    const res = await client.query("hello", 3);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://test.local:8080/query",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ query: "hello", topK: 3 }),
      })
    );
    expect(res.hits).toHaveLength(1);
    expect(res.hits[0].score).toBe(0.9);
  });

  it("query() with object param", async () => {
    fetchMock.mockResolvedValueOnce(ok({ query: "test", hits: [] }));
    await client.query({ query: "test", topK: 10 });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ query: "test", topK: 10 });
  });

  it("chat() parses split SSE frames and sends authentication", async () => {
    fetchMock.mockResolvedValueOnce(
      sse([
        'event: message\ndata: {"type":"text-delta","text":"Hel',
        'lo"}\n\nevent: done\ndata: {"type":"done","hits":[]}\n\n',
      ]),
    );

    const events = [];
    for await (const event of client.chat("What is Larkup?")) events.push(event);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://test.local:8080/chat");
    expect((init.headers as Headers).get("Authorization")).toBe("Bearer test-key-123");
    expect(JSON.parse(init.body)).toEqual({
      messages: [{ role: "user", content: "What is Larkup?" }],
    });
    expect(events).toEqual([
      { type: "text-delta", text: "Hello" },
      { type: "done", hits: [] },
    ]);
  });

  it("chatText() collects text deltas", async () => {
    fetchMock.mockResolvedValueOnce(
      sse([
        'data: {"type":"text-delta","text":"Hello "}\n\n',
        'data: {"type":"text-delta","text":"world"}\n\n',
      ]),
    );
    await expect(client.chatText("hello")).resolves.toBe("Hello world");
  });

  // ── List Documents ──────────────────────────────────────────────────────
  it("listDocuments() with pagination params", async () => {
    fetchMock.mockResolvedValueOnce(
      ok({ documents: [], total: 0, page: 2, limit: 10, totalPages: 0 })
    );
    const res = await client.listDocuments(2, 10);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://test.local:8080/documents?page=2&limit=10",
      expect.any(Object)
    );
    expect(res.page).toBe(2);
  });

  it("listDocuments() defaults to page 1, limit 20", async () => {
    fetchMock.mockResolvedValueOnce(
      ok({ documents: [], total: 0, page: 1, limit: 20, totalPages: 0 })
    );
    await client.listDocuments();
    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://test.local:8080/documents?page=1&limit=20"
    );
  });

  // ── Get Document ────────────────────────────────────────────────────────
  it("getDocument() fetches by id", async () => {
    const doc = { id: "abc", text: "hello", title: "Hi", documentId: "abc" };
    fetchMock.mockResolvedValueOnce(ok(doc));
    const res = await client.getDocument("abc");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://test.local:8080/documents/abc"
    );
    expect(res.id).toBe("abc");
  });

  // ── Add Document ────────────────────────────────────────────────────────
  it("addDocument() posts to /documents", async () => {
    fetchMock.mockResolvedValueOnce(ok({ success: true, id: "new-1" }));
    const res = await client.addDocument({ text: "content", title: "Title" });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://test.local:8080/documents",
      expect.objectContaining({ method: "POST" })
    );
    expect(res.id).toBe("new-1");
  });

  // ── Update Document ─────────────────────────────────────────────────────
  it("updateDocument() puts to /documents/:id", async () => {
    fetchMock.mockResolvedValueOnce(ok({ success: true }));
    await client.updateDocument("xyz", { text: "updated" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://test.local:8080/documents/xyz");
    expect(init.method).toBe("PUT");
  });

  // ── Delete Document ─────────────────────────────────────────────────────
  it("deleteDocument() sends DELETE", async () => {
    fetchMock.mockResolvedValueOnce(ok({ success: true }));
    await client.deleteDocument("xyz");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://test.local:8080/documents/xyz");
    expect(init.method).toBe("DELETE");
  });

  // ── Scrape ──────────────────────────────────────────────────────────────
  it("scrape() posts url to /scrape", async () => {
    fetchMock.mockResolvedValueOnce(
      ok({ success: true, documentId: "d1", chunks: 3 })
    );
    const res = await client.scrape("https://example.com");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://test.local:8080/scrape",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ url: "https://example.com" }),
      })
    );
    expect(res.success).toBe(true);
  });

  // ── Error handling ──────────────────────────────────────────────────────
  it("throws on 401 with error message from body", async () => {
    fetchMock.mockResolvedValueOnce(
      err(401, { error: "Missing Authorization header." })
    );
    await expect(client.query("test")).rejects.toThrow(
      "Larkup API Error (401): Missing Authorization header."
    );
  });

  it("throws on 500 with statusText fallback", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => {
        throw new Error("not json");
      },
    });
    await expect(client.health()).rejects.toThrow(
      "Larkup API Error (500): Internal Server Error"
    );
  });

  // ── Base URL handling ───────────────────────────────────────────────────
  it("strips trailing slash from baseUrl", async () => {
    const c = new LarkupClient({ baseUrl: "http://example.com/" });
    fetchMock.mockResolvedValueOnce(ok({ ok: true }));
    await c.health();
    expect(fetchMock.mock.calls[0][0]).toBe("http://example.com/health");
  });
});
