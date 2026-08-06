import { NextResponse } from 'next/server';
import { getMediaAsset } from '@larkup/core/media-store';
import {
  decideBackgroundRefinement,
  getBackgroundRefinement,
} from '@larkup/core/video-knowledge/inspection-store';
import { runWithServer } from '@larkup/core/workspace';
import { executeApprovedBackgroundRefinement } from '@/app/api/media/inspect/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Approve or decline a previously budget-gated refinement under the asset's workspace scope. */
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const serverId = new URL(req.url).searchParams.get('serverId');
  const handler = async () => {
    const { id } = await context.params;
    const body = (await req.json().catch(() => ({}))) as { decision?: unknown };
    if (body.decision !== 'approve' && body.decision !== 'decline') {
      return NextResponse.json({ error: 'decision must be approve or decline.' }, { status: 400 });
    }
    const pending = await getBackgroundRefinement(id);
    if (!pending)
      return NextResponse.json({ error: 'Background refinement not found.' }, { status: 404 });
    const asset = await getMediaAsset(pending.mediaAssetId);
    if (!asset || asset.activeVideoKnowledgeRevisionId !== pending.parentRevisionId) {
      return NextResponse.json(
        { error: 'This refinement is no longer tied to an active authorized asset revision.' },
        { status: 409 },
      );
    }
    const job = await decideBackgroundRefinement(id, body.decision);
    if (!job)
      return NextResponse.json(
        { error: 'This refinement is no longer awaiting approval.' },
        { status: 409 },
      );
    if (job.status === 'queued') {
      // The response is returned immediately; work is durable and its terminal
      // result is visible through the same refinement record.
      void executeApprovedBackgroundRefinement(job.id);
    }
    return NextResponse.json({ job });
  };
  return serverId ? runWithServer(serverId, handler) : handler();
}
