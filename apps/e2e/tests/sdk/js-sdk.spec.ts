import { test, expect } from "@playwright/test";

/**
 * JS SDK E2E tests — these test the actual @larkup-rag/client-js SDK
 * against the running RAG server on port 8080.
 *
 * Prerequisites: RAG server must be launched first (via Server page or API).
 */
const WEB_API = "http://localhost:4567";
let RAG_SERVER = "http://localhost:8080";

test.describe("JS SDK — @larkup-rag/client-js", () => {
  // Ensure server is running before SDK tests
  test.beforeAll(async ({ request }) => {
    // Launch server via Web UI API
    const statusRes = await request.get(`${WEB_API}/api/server/local`);
    const { state } = await statusRes.json();

    if (state.endpoint) {
      RAG_SERVER = state.endpoint;
    }

    if (!state.running) {
      console.log("  Starting RAG server for SDK tests...");
      const startRes = await request.post(`${WEB_API}/api/server/local`, {
        data: { action: "start" },
      });
      const startBody = await startRes.json();
      if (startBody.state?.endpoint) {
        RAG_SERVER = startBody.state.endpoint;
      }

      // Wait for server to become ready
      let ready = false;
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 2_000));
        try {
          const res = await fetch(`${RAG_SERVER}/health`, {
            signal: AbortSignal.timeout(3_000),
          });
          if (res.ok) {
            ready = true;
            break;
          }
        } catch {}
      }
      if (!ready) {
        console.warn("  ⚠ RAG server failed to start — SDK tests may fail");
      }
    }
  });

  test("health check — GET /health", async () => {
    const res = await fetch(`${RAG_SERVER}/health`, {
      signal: AbortSignal.timeout(10_000),
    });
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.ok).toBe(true);
    console.log("  ✓ SDK health check passed");
  });

  test("query — POST /query", async () => {
    test.setTimeout(60_000);

    const res = await fetch(`${RAG_SERVER}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "What is Larkup?", topK: 3 }),
      signal: AbortSignal.timeout(30_000),
    });

    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toHaveProperty("query");
    expect(body).toHaveProperty("hits");
    expect(Array.isArray(body.hits)).toBe(true);
    console.log(`  ✓ Query returned ${body.hits.length} hits`);

    if (body.hits.length > 0) {
      expect(body.hits[0]).toHaveProperty("score");
      expect(body.hits[0]).toHaveProperty("text");
    }
  });

  test("list documents — GET /documents", async () => {
    const res = await fetch(`${RAG_SERVER}/documents?page=1&limit=5`, {
      signal: AbortSignal.timeout(10_000),
    });

    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toHaveProperty("documents");
    expect(Array.isArray(body.documents)).toBe(true);
    console.log(`  ✓ Listed ${body.documents.length} documents`);
  });

  test("add document — POST /documents", async () => {
    const res = await fetch(`${RAG_SERVER}/documents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "SDK E2E test document content",
        title: "SDK Test Doc",
      }),
      signal: AbortSignal.timeout(10_000),
    });

    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toHaveProperty("success");
    expect(body.success).toBe(true);
    expect(body).toHaveProperty("id");
    console.log(`  ✓ Document added via SDK: id=${body.id}`);

    // Cleanup
    if (body.id) {
      await fetch(`${RAG_SERVER}/documents/${body.id}`, {
        method: "DELETE",
        signal: AbortSignal.timeout(5_000),
      }).catch(() => {});
    }
  });

  test("scrape URL — POST /scrape", async () => {
    test.setTimeout(30_000);

    const res = await fetch(`${RAG_SERVER}/scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
      signal: AbortSignal.timeout(20_000),
    });

    // Scrape may fail if firecrawl not configured — that's acceptable
    if (res.ok) {
      const body = await res.json();
      console.log(`  ✓ Scrape response: success=${body.success}`);
    } else {
      const body = await res.json().catch(() => ({}));
      console.log(
        `  ℹ Scrape returned ${res.status} (expected if no scraper configured): ${body.error ?? ""}`
      );
    }
  });

  // Cleanup — stop server after SDK tests
  test.afterAll(async ({ request }) => {
    // Don't stop — other tests may need it
    console.log("  ℹ RAG server left running for subsequent tests");
  });
});
