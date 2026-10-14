import { expect, test } from '@playwright/test';
import { env, ENV_KEYS, hasEnv } from '../../utils/env-loader';

test.describe.serial('collaboration release readiness', () => {
  test.skip(
    !hasEnv(ENV_KEYS.AI_GATEWAY_API_KEY) || !hasEnv(ENV_KEYS.DEEPSEEK_API_KEY),
    'AI_GATEWAY_API_KEY and DEEPSEEK_API_KEY are required for live release readiness',
  );

  const documentIds: string[] = [];
  let datasetId = '';

  test.afterAll(async ({ request }) => {
    await Promise.all(
      documentIds.map((id) => request.delete(`/api/documents?id=${encodeURIComponent(id)}`)),
    );
    if (datasetId) {
      await request.delete(`/api/tabular?id=${encodeURIComponent(datasetId)}`);
    }
  });

  test('indexes text and CSV, answers, charts, and returns a complete list', async ({
    request,
  }) => {
    test.setTimeout(360_000);

    const configResponse = await request.get('/api/config');
    expect(configResponse.ok()).toBe(true);
    const { config } = await configResponse.json();
    const updateResponse = await request.put('/api/config', {
      data: {
        ...config,
        vectorStore: 'lancedb',
        embeddingProvider: 'vercel_ai_gateway',
        embeddingApiKey: env(ENV_KEYS.AI_GATEWAY_API_KEY),
        embeddingModelId: 'openai/text-embedding-3-small',
        chatProvider: 'deepseek',
        chatApiKey: env(ENV_KEYS.DEEPSEEK_API_KEY),
        chatModelId: 'deepseek/deepseek-chat',
      },
    });
    expect(updateResponse.ok(), await updateResponse.text()).toBe(true);

    const rows = Array.from({ length: 40 }, (_, index) => ({
      item: `ITEM-${String(index + 1).padStart(3, '0')}`,
      region: ['North', 'South', 'East', 'West'][index % 4],
      units: (index + 1) * 3,
    }));
    const tabularResponse = await request.post('/api/tabular', {
      data: { fileName: 'release-readiness.csv', rows },
    });
    const tabularBody = await tabularResponse.json();
    expect(tabularResponse.ok(), JSON.stringify(tabularBody)).toBe(true);
    datasetId = tabularBody.id;

    const documents = [
      {
        title: 'Collaboration readiness note',
        content:
          'The release readiness codename is Copper Finch. Collaboration mode supports shared grounded answers.',
        source: 'text',
      },
      {
        title: 'release-readiness.csv',
        content: rows
          .map((row) => `item: ${row.item} | region: ${row.region} | units: ${row.units}`)
          .join('\n'),
        source: 'files',
        metadata: { fileName: 'release-readiness.csv', tabularDatasetId: datasetId },
      },
    ];

    for (const document of documents) {
      const response = await request.post('/api/documents', { data: document });
      const body = await response.json();
      expect(response.status(), JSON.stringify(body)).toBe(201);
      documentIds.push(body.document.id);
    }

    const indexResponse = await request.post('/api/index', { data: {} });
    expect(indexResponse.status(), await indexResponse.text()).toBe(202);
    let indexStatus: { run?: { status?: string; error?: string } } = {};
    await expect
      .poll(
        async () => {
          indexStatus = await (await request.get('/api/index')).json();
          if (indexStatus.run?.status === 'failed') {
            throw new Error(indexStatus.run.error || 'Indexing failed');
          }
          return indexStatus.run?.status;
        },
        { timeout: 240_000, intervals: [1_000, 2_000, 5_000] },
      )
      .toBe('completed');

    async function chat(question: string) {
      const response = await request.post('/api/chat', {
        data: {
          messages: [
            {
              id: `question-${Date.now()}-${Math.random()}`,
              role: 'user',
              parts: [{ type: 'text', text: question }],
            },
          ],
        },
        timeout: 120_000,
      });
      const stream = await response.text();
      expect(response.ok(), stream).toBe(true);
      expect(stream).not.toContain('"type":"error"');
      expect(stream).not.toContain('AI_ToolChoiceViolationError');
      expect(stream).not.toContain('Model response did not contain a call to the required tool');
      expect(stream).not.toContain('DSML');
      return stream;
    }

    const answer = await chat('What is the release readiness codename?');
    expect(answer).toContain('Copper Finch');

    const chart = await chat(
      'Create a bar chart of total units by region from release-readiness.csv.',
    );
    expect(chart).toContain('"visualization"');
    expect(chart).toContain('North');
    expect(chart).toContain('South');

    const completeList = await chat(
      'List every item code in release-readiness.csv as a complete table. Do not omit rows.',
    );
    expect(completeList).toContain('queryTabularData');
    expect(completeList).toContain('ITEM-001');
    expect(completeList).toContain('ITEM-040');
  });
});
