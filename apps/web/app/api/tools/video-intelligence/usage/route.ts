import { NextResponse } from 'next/server';
import { runWithProject } from '@larkup/core/project-store';
import {
  cancelOnlyActiveVideoIntelligenceJob,
  getVideoIntelligenceUsage,
} from '@/lib/media/video-intelligence-adapter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const serverId = new URL(request.url).searchParams.get('serverId');
  try {
    const usage = serverId
      ? await runWithProject(serverId, getVideoIntelligenceUsage)
      : await getVideoIntelligenceUsage();
    return NextResponse.json(usage);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not read video indexing usage.' },
      { status: 503 },
    );
  }
}

export async function DELETE(request: Request) {
  const serverId = new URL(request.url).searchParams.get('serverId');
  try {
    const cancel = () => cancelOnlyActiveVideoIntelligenceJob();
    if (serverId) await runWithProject(serverId, cancel);
    else await cancel();
    return NextResponse.json({ status: 'cancelled' });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not stop the active video job.' },
      { status: 409 },
    );
  }
}
