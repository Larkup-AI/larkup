import { NextRequest, NextResponse } from 'next/server';
import { readAgent, writeAgent, deleteAgent } from '@larkup/core/agent-store';
import { mergeAgentUpdate, redactAgentSecrets } from '@larkup/agent-contracts/redaction';

type Params = { params: Promise<{ agentId: string }> };

/**
 * GET /api/agents/[agentId]
 *
 * The operator-facing view. Credentials — knowledge-server retrieval keys, the
 * join code, channel bot tokens — come back masked with the redaction sentinel
 * rather than in the clear (plan §8.3). `PUT` accepts the sentinel back
 * unchanged, so the dashboard can round-trip an agent it cannot read the
 * secrets of.
 *
 * The widget uses `GET /api/agents/[agentId]/public`, which is far narrower.
 */
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { agentId } = await params;
    const agent = await readAgent(agentId);
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }
    return NextResponse.json(redactAgentSecrets(agent));
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

/** PUT /api/agents/[agentId] — partial update; masked secrets are preserved. */
export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const { agentId } = await params;
    const current = await readAgent(agentId);
    if (!current) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const updated = mergeAgentUpdate(current, await req.json());
    await writeAgent(updated);

    return NextResponse.json(redactAgentSecrets(updated));
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

/** DELETE /api/agents/[agentId] */
export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const { agentId } = await params;
    const agent = await readAgent(agentId);
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }
    await deleteAgent(agentId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
