import { NextResponse } from 'next/server';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  let body: { baseUrl: string; apiKey?: string; modelName: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { baseUrl, apiKey, modelName } = body;

  if (!baseUrl || !modelName) {
    return NextResponse.json(
      { error: 'Missing required fields: baseUrl and modelName' },
      { status: 400 },
    );
  }

  try {
    const customProvider = createOpenAI({
      baseURL: baseUrl,
      apiKey: apiKey || 'empty', // some backends require any string
    });

    const model = customProvider.chat(modelName);
    const { text } = await generateText({
      model,
      prompt: "Reply with the word 'OK'",
      maxOutputTokens: 16,
    });

    return NextResponse.json({ success: true, text });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'LLM connection failed',
      },
      { status: 400 },
    );
  }
}
