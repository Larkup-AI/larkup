import { NextRequest, NextResponse } from 'next/server';
import { readAgent, writeAgent } from '@larkup/core/agent-store';
import { getChannel, listChannels, validateChannelSettings } from '@larkup/channels-core';
import { mergeAgentUpdate, redactAgentSecrets } from '@larkup/agent-contracts/redaction';

type Params = { params: Promise<{ agentId: string }> };

/**
 * GET /api/agents/[agentId]/channels
 *
 * Everything the dashboard needs to render the channel list: the available
 * adapters with their config-field declarations (plan §4.2 — the schema drives
 * the form), plus this agent's stored settings with secrets masked.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { agentId } = await params;

  const agent = await readAgent(agentId);
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

  const redacted = redactAgentSecrets(agent);
  const origin = new URL(req.url).origin;

  return NextResponse.json({
    channels: listChannels().map((adapter) => {
      const stored = redacted.channels?.[adapter.id];
      return {
        id: adapter.id,
        name: adapter.name,
        description: adapter.description,
        configFields: adapter.configFields,
        supportsRegistration: typeof adapter.registerWebhook === 'function',
        webhookUrl: `${origin}/api/agents/${agentId}/channels/${adapter.id}`,
        enabled: stored?.enabled ?? false,
        settings: stored?.settings ?? {},
        lastInboundAt: stored?.lastInboundAt,
        lastErrorAt: stored?.lastErrorAt,
        lastError: stored?.lastError,
      };
    }),
  });
}

/**
 * PUT /api/agents/[agentId]/channels
 *
 * Body: `{ channelId, enabled, settings }`.
 *
 * Settings are validated against the adapter's own field declarations before
 * anything is written, and a masked secret sent back unchanged keeps its stored
 * value. Enabling a channel with an invalid configuration is refused outright —
 * a channel that is "on" but broken is worse than one that is off.
 */
export async function PUT(req: NextRequest, { params }: Params) {
  const { agentId } = await params;

  const agent = await readAgent(agentId);
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

  const body = (await req.json()) as {
    channelId?: string;
    enabled?: boolean;
    settings?: Record<string, string>;
  };

  const adapter = body.channelId ? getChannel(body.channelId) : undefined;
  if (!adapter) {
    return NextResponse.json({ error: `Unknown channel "${body.channelId}"` }, { status: 400 });
  }

  // Merge first so validation runs against the *effective* settings, including
  // secrets the dashboard could not read back and therefore echoed masked.
  const merged = mergeAgentUpdate(agent, {
    channels: {
      ...agent.channels,
      [adapter.id]: {
        enabled: body.enabled ?? false,
        settings: body.settings ?? {},
      },
    },
  });

  const effective = merged.channels?.[adapter.id];
  if (effective?.enabled) {
    const validation = validateChannelSettings(adapter, effective.settings);
    if (!validation.ok) {
      return NextResponse.json(
        {
          error: `The ${adapter.name} channel is not configured correctly.`,
          fields: validation.errors,
        },
        { status: 400 },
      );
    }
  }

  await writeAgent(merged);

  return NextResponse.json({
    ok: true,
    channelId: adapter.id,
    enabled: effective?.enabled ?? false,
    settings: redactAgentSecrets(merged).channels?.[adapter.id]?.settings ?? {},
  });
}
