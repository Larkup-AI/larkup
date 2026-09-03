import { NextResponse } from 'next/server';
import { readGpuActivity } from '@larkup/core/gpu-activity-store';
import { runWithProject } from '@larkup/core/project-store';

export const dynamic = 'force-dynamic';

/** Polled by GpuActivityIndicator; mirrors /api/index's shape and scoping. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  // The inspection route writes progress inside the source project's scoped
  // store. Poll that same scope so a chat never renders an unrelated stale
  // worker state from the default project.
  const projectId = url.searchParams.get('projectId') ?? url.searchParams.get('serverId');
  const activity = projectId
    ? await runWithProject(projectId, () => readGpuActivity())
    : await readGpuActivity();
  return NextResponse.json({ activity });
}
