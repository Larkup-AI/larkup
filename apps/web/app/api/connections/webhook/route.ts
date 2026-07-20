import { NextResponse } from 'next/server';
import { readAgentServerState } from '@larkup/core/generator/server-runtime';

export async function POST(req: Request) {
  try {
    const payload = await req.json();

    // In a real implementation, this would validate the webhook signature,
    // parse the incoming message format (e.g. from Slack/Discord/Custom),
    // and format it for the agent server.

    const state = await readAgentServerState();

    if (!state.running || !state.endpoint) {
      return NextResponse.json({ error: 'Agent server is not running locally.' }, { status: 503 });
    }

    // Forward to the local agent server
    const agentRes = await fetch(`${state.endpoint}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'user', content: payload.text || payload.message || JSON.stringify(payload) },
        ],
      }),
    });

    if (!agentRes.ok) {
      throw new Error(`Agent server returned ${agentRes.status}`);
    }

    // The agent server streams text back. We could collect it and return a sync response,
    // or stream it back. For webhooks, sync response is often expected.
    // In a real implementation, we might stream the response back to the webhook caller,
    // or asynchronously send the response back via the channel's API (e.g. Slack API).

    return NextResponse.json({ success: true, message: 'Message forwarded to agent' });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
