import { NextRequest, NextResponse } from 'next/server';
import { readAgent } from '@larkup/core/agent-store';
import { getChannel } from '@larkup/channels-core';

type Params = { params: Promise<{ agentId: string; channelId: string }> };

/**
 * GET /api/agents/[agentId]/channels/[channelId]/health
 *
 * Asks the provider whether the stored credentials actually work, rather than
 * whether a form was filled in. Plan §9 requires channel health checks; the
 * dashboard calls this so "Connected" means something.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { agentId, channelId } = await params;

  const adapter = getChannel(channelId);
  if (!adapter) {
    return NextResponse.json({ error: `Unknown channel "${channelId}"` }, { status: 404 });
  }

  const agent = await readAgent(agentId);
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

  const channel = agent.channels?.[channelId];
  if (!channel) {
    return NextResponse.json({ status: 'misconfigured', detail: 'Channel is not configured.' });
  }

  try {
    // Credentials are read here and never leave the server: only the adapter's
    // verdict is returned.
    return NextResponse.json(await adapter.health(channel.settings ?? {}));
  } catch (error) {
    return NextResponse.json({
      status: 'unreachable',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * POST — register this agent's webhook URL with the provider.
 *
 * Only some transports support it: Telegram needs `setWebhook`, a generic
 * webhook is configured on the caller's side and has nothing to register.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { agentId, channelId } = await params;

  const adapter = getChannel(channelId);
  if (!adapter) {
    return NextResponse.json({ error: `Unknown channel "${channelId}"` }, { status: 404 });
  }
  if (!adapter.registerWebhook) {
    return NextResponse.json(
      { ok: false, detail: `${adapter.name} does not support automatic registration.` },
      { status: 400 },
    );
  }

  const agent = await readAgent(agentId);
  const channel = agent?.channels?.[channelId];
  if (!agent || !channel) {
    return NextResponse.json({ error: 'Channel is not configured.' }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as { publicUrl?: string };
  const base = (body.publicUrl || new URL(req.url).origin).replace(/\/+$/, '');
  const webhookUrl = `${base}/api/agents/${agentId}/channels/${adapter.id}`;

  // A provider on the public internet cannot call localhost. Say so plainly
  // rather than letting the operator debug a silent non-delivery.
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(base)) {
    return NextResponse.json(
      {
        ok: false,
        detail: `${adapter.name} cannot reach ${base}. Deploy the agent, or expose this machine with a tunnel, then register again with the public URL.`,
      },
      { status: 400 },
    );
  }

  const result = await adapter.registerWebhook(webhookUrl, channel.settings ?? {});
  return NextResponse.json({ ...result, webhookUrl }, { status: result.ok ? 200 : 400 });
}
