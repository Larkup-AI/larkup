import { expect, test } from '@playwright/test';
import { env, ENV_KEYS, hasEnv } from '../../utils/env-loader';

type ModelCase = {
  label: string;
  provider: 'vercel_ai_gateway' | 'deepseek';
  modelId: string;
  apiKey: string;
  planner: 'openai/gpt-4.1-mini' | 'selected-model';
};

const runLiveMatrix = process.env.RUN_LONG_ANALYSIS_MODEL_EVALS === '1';

test.describe.serial('long analysis live model matrix', () => {
  test.skip(
    !runLiveMatrix || !hasEnv(ENV_KEYS.AI_GATEWAY_API_KEY) || !hasEnv(ENV_KEYS.DEEPSEEK_API_KEY),
    'Set RUN_LONG_ANALYSIS_MODEL_EVALS=1 with Gateway and DeepSeek keys to run paid live evals.',
  );

  test('produces one complete 102 × 3 matching artifact across model sizes and providers', async ({
    request,
  }) => {
    test.setTimeout(900_000);

    const originalResponse = await request.get('/api/config');
    expect(originalResponse.ok()).toBe(true);
    const { config: originalConfig } = await originalResponse.json();
    let datasetId = '';

    const gatewayKey = env(ENV_KEYS.AI_GATEWAY_API_KEY);
    const matrix: ModelCase[] = [
      {
        label: 'OpenAI small',
        provider: 'vercel_ai_gateway',
        modelId: 'openai/gpt-4o-mini',
        apiKey: gatewayKey,
        planner: 'openai/gpt-4.1-mini',
      },
      {
        label: 'OpenAI larger',
        provider: 'vercel_ai_gateway',
        modelId: 'openai/gpt-4.1',
        apiKey: gatewayKey,
        planner: 'openai/gpt-4.1-mini',
      },
      {
        label: 'Qwen small',
        provider: 'vercel_ai_gateway',
        modelId: 'alibaba/qwen-3-14b',
        apiKey: gatewayKey,
        planner: 'openai/gpt-4.1-mini',
      },
      {
        label: 'Qwen larger',
        provider: 'vercel_ai_gateway',
        modelId: 'alibaba/qwen-3-235b',
        apiKey: gatewayKey,
        planner: 'openai/gpt-4.1-mini',
      },
      {
        label: 'DeepSeek gateway',
        provider: 'vercel_ai_gateway',
        modelId: 'deepseek/deepseek-v3',
        apiKey: gatewayKey,
        planner: 'openai/gpt-4.1-mini',
      },
      {
        label: 'DeepSeek direct',
        provider: 'deepseek',
        modelId: 'deepseek/deepseek-chat',
        apiKey: env(ENV_KEYS.DEEPSEEK_API_KEY),
        planner: 'selected-model',
      },
    ];

    try {
      const rows = Array.from({ length: 102 }, (_, index) => ({
        Name: `Person ${index + 1}`,
        'Email Address': `person${index + 1}@example.test`,
        'Question 2: Current Needs: "What would you benefit from most right now?"': `Needs help with topic ${index % 17} and project ${(index + 5) % 13}.`,
        "Question 3: \"Anything else you'd like to add? Share what you're bringing to the table or what you're looking for.\"": `Offers experience with topic ${(index + 3) % 17} and project ${index % 13}.`,
      }));
      const datasetResponse = await request.post('/api/tabular', {
        data: { fileName: 'long-analysis-model-eval.csv', rows },
      });
      const datasetBody = await datasetResponse.json();
      expect(datasetResponse.ok(), JSON.stringify(datasetBody)).toBe(true);
      datasetId = datasetBody.id;

      const prompt =
        'You have a data document listing 102 participants. For each person from the list, make 3 matches with other people from the list based on people\'s needs and offers — Question 2: Current Needs: "What would you benefit from most right now?" and Question 3: "Anything else you\'d like to add? Share what you\'re bringing to the table or what you\'re looking for." Each person should be matched with no more than 6 people in total: 3 times they might be a good match for someone, and 3 times they should be matched with someone. For every match, write a one-sentence explanation of why this is the best choice and mention their email.';

      for (const modelCase of matrix) {
        const configResponse = await request.put('/api/config', {
          data: {
            ...originalConfig,
            defaultSandboxProvider: 'local',
            chatProvider: modelCase.provider,
            chatApiKey: modelCase.apiKey,
            chatModelId: modelCase.modelId,
          },
        });
        expect(configResponse.ok(), `${modelCase.label}: ${await configResponse.text()}`).toBe(
          true,
        );

        const startedAt = Date.now();
        const response = await request.post('/api/chat', {
          data: {
            messages: [
              {
                id: `long-analysis-${modelCase.modelId}-${Date.now()}`,
                role: 'user',
                parts: [{ type: 'text', text: prompt }],
              },
            ],
          },
          timeout: 180_000,
        });
        const stream = await response.text();
        expect(response.ok(), `${modelCase.label}: ${stream.slice(0, 2_000)}`).toBe(true);
        expect(stream, modelCase.label).toContain('executeAnalysis');
        expect(stream, modelCase.label).toMatch(/\\?"exitCode\\?":0/);
        expect(stream, modelCase.label).toMatch(/\\?"totalItems\\?":306/);
        expect(stream, modelCase.label).toMatch(/\\?"requestedItems\\?":102/);
        expect(stream, modelCase.label).toContain('person1@example.test');
        expect(stream, modelCase.label).toContain('person102@example.test');
        expect(stream, modelCase.label).not.toContain('AI_ToolChoiceViolationError');
        expect(stream, modelCase.label).not.toContain('Analysis completed without a usable result');
        expect(stream, `${modelCase.label} duplicated the artifact as prose`).not.toContain(
          '"type":"text-delta"',
        );

        console.log(
          `  ✓ ${modelCase.label}: selected=${modelCase.modelId}, planner=${modelCase.planner}, ${Date.now() - startedAt}ms`,
        );
      }
    } finally {
      if (datasetId) {
        await request.delete(`/api/tabular?id=${encodeURIComponent(datasetId)}`);
      }
      await request.put('/api/config', { data: originalConfig });
    }
  });
});
