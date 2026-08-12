import { NextRequest, NextResponse } from 'next/server';
import { listAgents, readAgent, writeAgent } from '@larkup/core/agent-store';
import { DEFAULT_WIDGET_STYLE } from '@larkup/agent-contracts';
import { redactAgentSecrets } from '@larkup/agent-contracts/redaction';
import type { AgentDefinition } from '@larkup/agent-contracts';

/** GET /api/agents — list all agents, with credentials masked. */
export async function GET() {
  try {
    const ids = await listAgents();
    const agents = await Promise.all(ids.map((id) => readAgent(id)));
    return NextResponse.json(
      agents.filter((a): a is AgentDefinition => Boolean(a)).map(redactAgentSecrets),
    );
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

/** POST /api/agents — create a new agent */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const now = new Date().toISOString();

    if (!body.name || typeof body.name !== 'string') {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    const id: string =
      body.id ??
      body.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 48) +
        '-' +
        Date.now().toString(36);

    const definition: AgentDefinition = {
      id,
      name: body.name,
      description: body.description ?? '',
      createdAt: now,
      updatedAt: now,
      chatProvider: body.chatProvider ?? 'openai',
      chatModelId: body.chatModelId ?? 'gpt-4o-mini',
      systemPrompt: body.systemPrompt ?? 'You are a helpful assistant.',
      knowledgeSources: body.knowledgeSources ?? [],
      enabledToolIds: body.enabledToolIds ?? [],
      enabledSkillIds: body.enabledSkillIds ?? [],
      allowedOrigins: body.allowedOrigins ?? ['*'],
      authMode: body.authMode ?? 'none',
      // Without these two the create call silently dropped what the caller
      // asked for: an agent created with `authMode: "join-code"` had no code to
      // check against, and a channel supplied at creation vanished.
      ...(body.joinCode ? { joinCode: body.joinCode } : {}),
      ...(body.channels ? { channels: body.channels } : {}),
      widgetStyle: body.widgetStyle ?? DEFAULT_WIDGET_STYLE,
    };

    await writeAgent(definition);
    return NextResponse.json(redactAgentSecrets(definition), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
