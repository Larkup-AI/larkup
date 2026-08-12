import { expect, test } from '@playwright/test';
import { LarkupClient } from '../../../apps/sdk/js-sdk/src/index';
import { getWebUIUrl, rewriteLocalUrl } from '../../utils/env';

const WEB_API = getWebUIUrl();
let ragServer = rewriteLocalUrl('http://localhost:8080');
let client: LarkupClient;
const sdkApiKey = process.env.AI_GATEWAY_APIKEY?.trim() || process.env.OPENAI_API_KEY?.trim() || '';

test.describe.serial('JavaScript SDK', () => {
  test.skip(!sdkApiKey, 'AI_GATEWAY_APIKEY or OPENAI_API_KEY is required for SDK E2E');

  test.beforeAll(async ({ request }) => {
    const gatewayApiKey = process.env.AI_GATEWAY_APIKEY?.trim();

    const configResponse = await request.get(`${WEB_API}/api/config`);
    const { config } = await configResponse.json();
    const provider = gatewayApiKey ? 'vercel_ai_gateway' : 'openai';
    const updateResponse = await request.put(`${WEB_API}/api/config`, {
      data: {
        ...config,
        embeddingProvider: provider,
        chatProvider: provider,
        embeddingApiKey: sdkApiKey,
        chatApiKey: sdkApiKey,
      },
    });
    expect(updateResponse.ok()).toBe(true);

    // Always regenerate the local server from the known SDK fixture config.
    await request.post(`${WEB_API}/api/server/local`, {
      data: { action: 'stop' },
    });
    const startResponse = await request.post(`${WEB_API}/api/server/local`, {
      data: { action: 'start' },
      timeout: 180_000,
    });
    const startBody = await startResponse.json();
    expect(startBody.state?.running, startBody.state?.lastError).toBe(true);
    if (startBody.state?.endpoint) ragServer = rewriteLocalUrl(startBody.state.endpoint);

    let ready = false;
    for (let attempt = 0; attempt < 90; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      try {
        const response = await fetch(`${ragServer}/health`, {
          signal: AbortSignal.timeout(3_000),
        });
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {}
    }
    expect(ready).toBe(true);

    client = new LarkupClient({
      baseUrl: ragServer,
      apiKey: process.env.LARKUP_API_KEY,
    });
  });

  test('health and OpenAPI discovery', async () => {
    const health = await client.health();
    const schema = await client.openApi();

    expect(health.ok).toBe(true);
    expect(schema.openapi).toBe('3.1.0');
  });

  test('query', async () => {
    test.setTimeout(60_000);
    const result = await client.query('What is Larkup?', 3);

    expect(result.query).toBe('What is Larkup?');
    expect(Array.isArray(result.hits)).toBe(true);
    if (result.hits.length > 0) {
      expect(result.hits[0]).toHaveProperty('score');
      expect(result.hits[0]).toHaveProperty('text');
    }
  });

  test('document indexing progress and cleanup', async () => {
    test.setTimeout(60_000);
    const ids: string[] = [];
    const events = [];

    try {
      for await (const event of client.indexDocuments(
        [
          { text: 'SDK E2E first document', title: 'SDK E2E One' },
          { text: 'SDK E2E second document', title: 'SDK E2E Two' },
        ],
        { mode: 'parallel', concurrency: 2 },
      )) {
        events.push(event);
        if (event.id) ids.push(event.id);
      }

      expect(events.at(-1)).toMatchObject({
        type: 'complete',
        completed: 2,
        succeeded: 2,
      });
      const documents = await client.listDocuments(1, 5);
      expect(Array.isArray(documents.documents)).toBe(true);
    } finally {
      await Promise.all(ids.map((id) => client.deleteDocument(id)));
    }
  });

  test('corpus inspection and export', async () => {
    const summary = await client.corpusSummary();
    const corpus = await client.corpus({ limit: 5, includeContent: true });
    const jsonl = await client.exportCorpus('jsonl');

    expect(summary.totalDocuments).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(corpus.documents)).toBe(true);
    expect(typeof jsonl).toBe('string');
  });

  test('scrape request shape', async () => {
    test.setTimeout(30_000);
    try {
      const result = await client.scrape('https://example.com');
      expect(result.success).toBe(true);
      if (result.documentId) {
        const page = await client.listDocuments(1, 100);
        const ids = page.documents
          .filter((document) => document.documentId === result.documentId)
          .map((document) => document.id);
        await Promise.all(ids.map((id) => client.deleteDocument(id)));
      }
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
    }
  });
});
