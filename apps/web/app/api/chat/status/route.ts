import { NextResponse } from 'next/server';
import { readConfig } from '@larkup/core/config-store';
import { readRun } from '@larkup/core/index-store';
import { runWithProject } from '@larkup/core/project-store';
import { workspaceModelStatus } from '@larkup/core/workspace-model-status';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const operation = async () => {
    const [config, run] = await Promise.all([readConfig(), readRun()]);
    return NextResponse.json(
      await workspaceModelStatus(
        config,
        run?.status === 'completed' && (run.totalChunks ?? 0) > 0,
        params.get('provider'),
      ),
    );
  };
  const projectId = params.get('projectId');
  return projectId ? runWithProject(projectId, operation) : operation();
}
