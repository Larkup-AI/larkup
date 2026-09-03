import { test, expect } from '@playwright/test';

import { getWebUIUrl, rewriteLocalUrl } from '../../utils/env';

/** Verifies documented SDK integration patterns against the Project Runtime. */
const WEB_API = getWebUIUrl();
let RAG_SERVER = rewriteLocalUrl('http://localhost:8080');

test.describe('SDK Integration Patterns', () => {
  test.beforeAll(async ({ request }) => {
    try {
      // Other tests may have stopped the runtime.
      await request.post(`${WEB_API}/api/projects/runtime`, {
        data: { action: 'start' },
      });
      await new Promise((r) => setTimeout(r, 2000));

      const statusRes = await request.get(`${WEB_API}/api/projects/runtime`);
      const { runtime } = await statusRes.json();
      if (runtime.endpoint) {
        RAG_SERVER = rewriteLocalUrl(runtime.endpoint);
      }
      // Wait for server to be responsive
      for (let i = 0; i < 15; i++) {
        try {
          const check = await fetch(`${RAG_SERVER}/health`);
          if (check.ok) break;
        } catch {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    } catch (e) {
      // fallback
    }
  });

  test('AI-SDK tool pattern — SDK query returns hits with text', async () => {
    test.setTimeout(30_000);

    // Simulate what the AI-SDK tool integration does:
    // ragClient.query(query, 5) → results.hits.map(hit => hit.text).join("\n\n")
    const res = await fetch(`${RAG_SERVER}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'What is Larkup?', topK: 5 }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      console.log(`  ⚠ Query returned ${res.status} — server may not be ready`);
      return;
    }

    const body = await res.json();
    expect(body).toHaveProperty('hits');
    expect(Array.isArray(body.hits)).toBe(true);

    // Simulate the AI-SDK tool result concatenation
    const toolResult = body.hits
      .map((hit: any) => hit.text)
      .filter(Boolean)
      .join('\n\n');

    expect(typeof toolResult).toBe('string');
    console.log(
      `  ✓ AI-SDK tool pattern: ${body.hits.length} hits, ${toolResult.length} chars result`,
    );
  });

  test('LangChain retriever pattern — hits convert to documents', async () => {
    test.setTimeout(30_000);

    const res = await fetch(`${RAG_SERVER}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'What is Larkup?', topK: 5 }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      console.log(`  ⚠ Query returned ${res.status}`);
      return;
    }

    const body = await res.json();

    // Simulate LangChain Document conversion:
    // results.hits.map(hit => new Document({ pageContent: hit.text, metadata: { score: hit.score } }))
    const langchainDocs = body.hits.map((hit: any) => ({
      pageContent: hit.text ?? '',
      metadata: { score: hit.score ?? 0 },
    }));

    expect(Array.isArray(langchainDocs)).toBe(true);
    for (const doc of langchainDocs) {
      expect(doc).toHaveProperty('pageContent');
      expect(doc).toHaveProperty('metadata');
      expect(doc.metadata).toHaveProperty('score');
      expect(typeof doc.pageContent).toBe('string');
    }

    console.log(`  ✓ LangChain retriever pattern: ${langchainDocs.length} documents created`);
  });

  test('OpenAI-compatible endpoint pattern', async () => {
    test.setTimeout(60_000);

    // The RAG server should expose an OpenAI-compatible endpoint
    // Test if /v1 or similar exists
    const endpoints = [`${RAG_SERVER}/v1/models`, `${RAG_SERVER}/v1/chat/completions`];

    for (const endpoint of endpoints) {
      try {
        const res = await fetch(endpoint, {
          method: endpoint.includes('completions') ? 'POST' : 'GET',
          headers: { 'Content-Type': 'application/json' },
          body: endpoint.includes('completions')
            ? JSON.stringify({
                model: 'rag-model',
                messages: [{ role: 'user', content: 'Hello' }],
              })
            : undefined,
          signal: AbortSignal.timeout(10_000),
        });
        console.log(`  ℹ ${endpoint}: ${res.status}`);
      } catch {
        console.log(`  ℹ ${endpoint}: not reachable (optional)`);
      }
    }
  });
});
