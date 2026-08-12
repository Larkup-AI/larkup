import { NextRequest, NextResponse } from 'next/server';
import { readAgent, writeAgent } from '@larkup/core/agent-store';
import { runAgentTurn } from '@larkup/core/agent-runtime';
import { appendToSession, readSession } from '@larkup/core/session-store';
import { dispatchInbound, getChannel, type ChannelEvent } from '@larkup/channels-core';

export const maxDuration = 60;

type Params = { params: Promise<{ agentId: string; channelId: string }> };

/**
 * POST /api/agents/[agentId]/channels/[channelId]
 *
 * The inbound webhook every channel provider calls. This URL is public by
 * necessity — Telegram will not authenticate to us — so `dispatchInbound`
 * verifies the request with the adapter *before* the agent, the model, or any
 * tool runs. The origin allow-list from TASK 05 does not apply here: providers
 * are servers and send no `Origin`.
 *
 * Status codes matter to the provider:
 *   200 — handled, or deliberately ignored. Do not retry.
 *   401/403 — verification failed.
 *   500/502 — transient; the provider should retry, and the idempotency claim
 *             has been released so the retry does real work.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { agentId, channelId } = await params;

  const adapter = getChannel(channelId);
  if (!adapter) {
    return NextResponse.json({ error: `Unknown channel "${channelId}"` }, { status: 404 });
  }

  const agent = await readAgent(agentId);
  if (!agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  }

  const channel = agent.channels?.[channelId];
  if (!channel?.enabled) {
    // 403 rather than 404: the operator disabled it, and a provider that keeps
    // calling should be told it is not welcome rather than that it is lost.
    return NextResponse.json(
      { error: `The ${adapter.name} channel is not enabled for this agent.` },
      { status: 403 },
    );
  }

  // The adapter needs the exact bytes to verify a signature; parsing first and
  // re-serializing would change them.
  const rawBody = await req.text();
  let parsedBody: unknown;
  try {
    parsedBody = rawBody ? JSON.parse(rawBody) : undefined;
  } catch {
    parsedBody = undefined;
  }

  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  const events: ChannelEvent[] = [];
  let answer = '';

  const result = await dispatchInbound({
    adapter,
    agentId,
    settings: channel.settings ?? {},
    request: {
      method: req.method,
      headers,
      rawBody,
      body: parsedBody,
      query: Object.fromEntries(req.nextUrl.searchParams.entries()),
    },
    onEvent: (event) => {
      events.push(event);
      console.log(`[channel:${channelId}] ${event.type}`, JSON.stringify(event));
    },
    runAgent: async ({ sessionId, message }) => {
      // Channel conversations have no client-side transcript, so history comes
      // from the server-side session store.
      const history = await readSession(sessionId);
      const turn = await runAgentTurn(agentId, {
        messages: [...history, { role: 'user', content: message }],
        signal: req.signal,
      });
      await appendToSession(sessionId, message, turn.text);
      answer = turn.text;
      return { text: turn.text };
    },
  });

  await recordChannelActivity(agentId, channelId, events);

  // The generic webhook has no callback of its own unless configured, so the
  // answer rides back in the response. Harmless for providers that ignore it.
  const body = result.status === 200 && answer ? { ...result.body, reply: answer } : result.body;

  return NextResponse.json(body, { status: result.status });
}

/**
 * Persist the channel's last-seen and last-error state.
 *
 * Written on the request path rather than by a background job so that the
 * dashboard's channel card reflects reality immediately after a test message —
 * which is the moment an operator is actually looking at it.
 */
async function recordChannelActivity(
  agentId: string,
  channelId: string,
  events: ChannelEvent[],
): Promise<void> {
  const failure = events.find(
    (e): e is Extract<ChannelEvent, { type: 'delivery.failed' | 'run.failed' }> =>
      e.type === 'delivery.failed' || e.type === 'run.failed',
  );
  const delivered = events.some((e) => e.type === 'delivered');
  if (!failure && !delivered) return;

  try {
    const agent = await readAgent(agentId);
    const channel = agent?.channels?.[channelId];
    if (!agent || !channel) return;

    const now = new Date().toISOString();
    await writeAgent({
      ...agent,
      channels: {
        ...agent.channels,
        [channelId]: {
          ...channel,
          ...(delivered ? { lastInboundAt: now, lastError: undefined } : {}),
          ...(failure ? { lastErrorAt: now, lastError: failure.error } : {}),
        },
      },
    });
  } catch (error) {
    // Never fail a delivered answer because bookkeeping failed.
    console.warn(`[channel:${channelId}] could not record activity:`, error);
  }
}

/** GET — a liveness probe operators (and providers) can call by hand. */
export async function GET(req: NextRequest, { params }: Params) {
  const { agentId, channelId } = await params;

  const adapter = getChannel(channelId);
  if (!adapter) {
    return NextResponse.json({ error: `Unknown channel "${channelId}"` }, { status: 404 });
  }

  const agent = await readAgent(agentId);
  const enabled = Boolean(agent?.channels?.[channelId]?.enabled);

  return NextResponse.json({
    channel: adapter.id,
    agentId,
    enabled,
    method: 'POST',
    detail: enabled
      ? `Send ${adapter.name} updates to this URL with POST.`
      : `The ${adapter.name} channel is not enabled for this agent.`,
  });
}
