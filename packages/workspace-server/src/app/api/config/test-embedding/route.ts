import { createOpenAI } from '@ai-sdk/openai';
import { embed } from 'ai';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  let body: { baseUrl: string; apiKey?: string; modelName: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { baseUrl, apiKey, modelName } = body;

  if (!baseUrl || !modelName) {
    return Response.json(
      { error: 'Missing required fields: baseUrl and modelName' },
      { status: 400 },
    );
  }

  try {
    const customProvider = createOpenAI({
      baseURL: baseUrl,
      apiKey: apiKey || 'empty', // some backends require any string
    });

    const model = customProvider.embedding(modelName);
    const { embedding } = await embed({ model, value: 'test connection' });

    return Response.json({ success: true, dimensions: embedding.length });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Embedding connection failed' },
      { status: 400 },
    );
  }
}
