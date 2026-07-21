import { NextResponse } from 'next/server';
import { generateText } from 'ai';
import { readConfig } from '@larkup/core/config-store';
import { getModelsByType } from '@larkup/core/models-cache';
import { toChatDescriptor } from '@larkup/core/chat-models/registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { base64 } = await req.json();
    if (!base64) {
      return NextResponse.json({ error: 'Missing image data' }, { status: 400 });
    }

    const config = await readConfig();
    const models = await getModelsByType('chat', config);
    // Find a vision-capable model (default to whatever the user has, but prefer strong ones)
    const visionModelInfo =
      models.find(
        (m) => m.id.includes('gpt-4') || m.id.includes('claude-3-5') || m.id.includes('gemini-1.5'),
      ) || models[0];

    const modelDesc = await toChatDescriptor(visionModelInfo.id, config);

    // Ensure data URL is formatted properly
    const urlFormat = base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`;

    const { text } = await generateText({
      model: modelDesc,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Describe this image in high detail. If it contains diagrams, tables, text, or database schemas, extract all the text, relationships, columns, and structures accurately.',
            },
            { type: 'image', image: urlFormat },
          ],
        },
      ],
    });

    return NextResponse.json({ description: text });
  } catch (err: any) {
    console.error('Image description failed:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
