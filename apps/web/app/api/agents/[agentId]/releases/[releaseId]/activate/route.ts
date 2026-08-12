import { NextRequest, NextResponse } from 'next/server';
import { getRelease, setActiveRelease } from '@larkup/core/agent-store';

type Params = { params: Promise<{ agentId: string; releaseId: string }> };

/** POST /api/agents/[agentId]/releases/[releaseId]/activate */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { agentId, releaseId } = await params;

    // Verify the release exists
    const release = await getRelease(agentId, releaseId);
    if (!release) {
      return NextResponse.json({ error: 'Release not found' }, { status: 404 });
    }

    await setActiveRelease(agentId, releaseId);
    return NextResponse.json({ success: true, activeReleaseId: releaseId });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
