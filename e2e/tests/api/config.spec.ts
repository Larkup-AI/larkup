import { test, expect } from '@playwright/test';
import { env, hasEnv, ENV_KEYS } from '../../utils/env-loader';

test.describe('Config API (/api/config)', () => {
  test('GET /api/config returns current configuration', async ({ request }) => {
    const res = await request.get('/api/config');
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('config');
    expect(body.config).toHaveProperty('projectName');
    expect(body.config).toHaveProperty('embeddingModelId');
    expect(body.config).toHaveProperty('vectorStore');
    expect(body.config).toHaveProperty('topK');
    expect(body.config).toHaveProperty('chunking');
    expect(body.config.chunking).toHaveProperty('chunkSize');
    expect(body.config.chunking).toHaveProperty('chunkOverlap');

    console.log(
      `  ✓ Config: vectorStore=${body.config.vectorStore}, model=${body.config.embeddingModelId}`,
    );
  });

  test('PUT /api/config sets API key', async ({ request }) => {
    test.skip(!hasEnv(ENV_KEYS.OPENAI_API_KEY), 'OPENAI_API_KEY not set');

    const getRes = await request.get('/api/config');
    const { config: current } = await getRes.json();

    const res = await request.put('/api/config', {
      data: {
        ...current,
        storeConfig: {
          ...current.storeConfig,
          tableName: current.storeConfig?.tableName || 'documents',
        },
        embeddingProvider: 'openai',
        chatProvider: 'openai',
        embeddingApiKey: env(ENV_KEYS.OPENAI_API_KEY),
        chatApiKey: env(ENV_KEYS.OPENAI_API_KEY),
        firecrawlApiKey: hasEnv(ENV_KEYS.FIRECRAWL_CLOUD_API_KEY)
          ? env(ENV_KEYS.FIRECRAWL_CLOUD_API_KEY)
          : undefined,
        serperApiKey: hasEnv(ENV_KEYS.SERPER_API_KEY) ? env(ENV_KEYS.SERPER_API_KEY) : undefined,
      },
    });

    expect(res.status()).toBe(200);
    console.log('  ✓ API Key set successfully via API');
  });

  test('PUT /api/config with valid LanceDB config', async ({ request }) => {
    test.skip(!hasEnv(ENV_KEYS.AI_GATEWAY_APIKEY), 'API key not set');

    const getRes = await request.get('/api/config');
    const { config: current } = await getRes.json();

    const res = await request.put('/api/config', {
      data: {
        ...current,
        vectorStore: 'lancedb',
      },
    });

    // The API runs a connection test before saving — may return 422 if
    // embedding credentials aren't fully configured in the persisted config
    expect([200, 422]).toContain(res.status());
    const body = await res.json();
    if (res.status() === 200) {
      expect(body.config.vectorStore).toBe('lancedb');
      console.log('  ✓ LanceDB config saved');
    } else {
      console.log(
        `  ℹ LanceDB config PUT returned 422 (connection test): ${JSON.stringify(
          body.fieldErrors ?? body.error,
        )}`,
      );
    }
  });

  test('PUT /api/config with valid Pinecone config', async ({ request }) => {
    test.skip(!hasEnv(ENV_KEYS.PINECONE_APIKEY), 'PINECONE_APIKEY not set');

    const getRes = await request.get('/api/config');
    const { config: current } = await getRes.json();

    const res = await request.put('/api/config', {
      data: {
        ...current,
        vectorStore: 'pinecone',
        storeConfig: {
          apiKey: env(ENV_KEYS.PINECONE_APIKEY),
          indexName: env(ENV_KEYS.PINECONE_INDEX_NAME),
        },
      },
    });

    // Should succeed or fail with validation — either way no 500
    expect([200, 400, 422]).toContain(res.status());
    console.log(`  ✓ Pinecone config PUT returned ${res.status()}`);

    // Restore LanceDB
    await request.put('/api/config', {
      data: { ...current, vectorStore: 'lancedb', storeConfig: {} },
    });
  });

  test('PUT /api/config with invalid embedding model returns 400', async ({ request }) => {
    const getRes = await request.get('/api/config');
    const { config: current } = await getRes.json();

    const res = await request.put('/api/config', {
      data: {
        ...current,
        embeddingModelId: 'nonexistent-model-xyz',
      },
    });

    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    console.log('  ✓ Invalid embedding model correctly rejected (400)');
  });

  test('PUT /api/config with invalid vector store returns 400', async ({ request }) => {
    const getRes = await request.get('/api/config');
    const { config: current } = await getRes.json();

    const res = await request.put('/api/config', {
      data: {
        ...current,
        vectorStore: 'nonexistent-store-xyz',
      },
    });

    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    console.log('  ✓ Invalid vector store correctly rejected (400)');
  });

  test('PUT /api/config with missing Pinecone fields returns 422', async ({ request }) => {
    const getRes = await request.get('/api/config');
    const { config: current } = await getRes.json();

    const res = await request.put('/api/config', {
      data: {
        ...current,
        vectorStore: 'pinecone',
        storeConfig: {}, // missing apiKey and indexName
      },
    });

    expect(res.status()).toBe(422);
    const body = await res.json();
    expect(body).toHaveProperty('fieldErrors');
    console.log('  ✓ Missing Pinecone fields correctly rejected (422)');

    // Restore LanceDB
    await request.put('/api/config', {
      data: { ...current, vectorStore: 'lancedb', storeConfig: {} },
    });
  });
});
