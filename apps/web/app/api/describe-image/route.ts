import { NextResponse } from 'next/server';
import { generateText } from 'ai';
import { readConfig } from '@larkup/core/config-store';
import { getModelsByType } from '@larkup/core/models-cache';
import { runWithServer } from '@larkup/core/workspace';
import { createChatModel, resolveConfiguredChatModel } from '@/lib/chat-model-provider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const serverId = new URL(req.url).searchParams.get('serverId');
  const describe = () => describeImage(req);
  return serverId ? runWithServer(serverId, describe) : describe();
}

async function describeImage(req: Request) {
  try {
    const { base64, base64Images, prompt } = (await req.json()) as {
      base64?: string;
      base64Images?: string[];
      prompt?: string;
    };
    const images = (base64Images?.length ? base64Images : base64 ? [base64] : []).slice(0, 6);
    if (images.length === 0) {
      return NextResponse.json({ error: 'Missing image data' }, { status: 400 });
    }

    const config = await readConfig();
    const models = await getModelsByType('language');
    const resolved = resolveConfiguredChatModel(config, models, { requiredTag: 'vision' });
    const model = createChatModel(
      resolved.provider,
      resolved.modelId,
      resolved.apiKey,
      config.customChatModels,
    ) as any;

    const defaultPrompt =
      'Provide a very brief, high-level summary of what this image contains (e.g., "A database ER diagram about films and actors", "A bar chart showing quarterly revenue"). Do NOT extract all text or exhaustively describe relationships. Keep it under 2 sentences.';

    const { text, usage } = await generateText({
      model,
      abortSignal: req.signal,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: prompt || defaultPrompt,
            },
            ...images.map((image) => ({
              type: 'image' as const,
              image: image.startsWith('data:') ? image : `data:image/jpeg;base64,${image}`,
            })),
          ],
        },
      ],
    });

    const { estimateCost, trackUsageEvent } = await import('@larkup/core/analytics-store');
    void trackUsageEvent({
      type: 'media_processing',
      mediaType: 'image',
      modelId: resolved.modelId,
      provider: resolved.provider,
      promptTokens: usage.inputTokens ?? 0,
      completionTokens: usage.outputTokens ?? 0,
      totalTokens: usage.totalTokens ?? 0,
      estimatedCost: estimateCost(
        resolved.modelId,
        usage.inputTokens ?? 0,
        usage.outputTokens ?? 0,
      ),
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json({ description: text });
  } catch (err: any) {
    console.error('Image description failed:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
