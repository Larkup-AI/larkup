import { NextResponse } from 'next/server';
import { runWithServer } from '@larkup/core/workspace';
import {
  getVideoKnowledgeJob,
  requestVideoKnowledgeJobCancellation,
} from '@larkup/core/video-knowledge/job-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Read/cancel the durable Video Knowledge Engine job for an authorized workspace. */
export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const serverId = new URL(req.url).searchParams.get('serverId');
  const handler = async () => {
    const { id } = await context.params;
    const job = await getVideoKnowledgeJob(id);
    return job
      ? NextResponse.json({ job })
      : NextResponse.json({ error: 'Video knowledge job not found.' }, { status: 404 });
  };
  return serverId ? runWithServer(serverId, handler) : handler();
}

export async function DELETE(req: Request, context: { params: Promise<{ id: string }> }) {
  const serverId = new URL(req.url).searchParams.get('serverId');
  const handler = async () => {
    const { id } = await context.params;
    const job = await requestVideoKnowledgeJobCancellation(id);
    return job
      ? NextResponse.json({ job })
      : NextResponse.json({ error: 'Video knowledge job cannot be cancelled.' }, { status: 409 });
  };
  return serverId ? runWithServer(serverId, handler) : handler();
}
