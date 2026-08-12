import { NextRequest, NextResponse } from 'next/server';
import { listReleases, publishRelease } from '@larkup/core/agent-store';

type Params = { params: Promise<{ agentId: string }> };

/** GET /api/agents/[agentId]/releases */
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { agentId } = await params;
    const releases = await listReleases(agentId);
    return NextResponse.json(releases);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

/** POST /api/agents/[agentId]/releases */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { agentId } = await params;
    const body = await req.json();

    if (!body.version || typeof body.version !== 'string') {
      return NextResponse.json({ error: 'version is required' }, { status: 400 });
    }

    // Pass empty extensions for now (TASK 05 will handle extension locking)
    const release = await publishRelease(
      agentId,
      body.version,
      {},
      body.releaseNotes,
      body.publishedBy,
    );

    return NextResponse.json(release, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
