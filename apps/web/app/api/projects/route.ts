import { NextResponse } from 'next/server';
import {
  createProject,
  deleteProject,
  getProjectWorkspace,
  renameProject,
  resetLocalProjects,
  runWithProject,
  setActiveProject,
  type ProjectMeta,
} from '@larkup/core/project-store';
import { corpusStats } from '@larkup/core/documents-store';
import { readRun } from '@larkup/core/index-store';
import { readServerState, stopServer } from '@larkup/core/generator/server-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface ProjectSummary extends ProjectMeta {
  sourceCount: number;
  indexed: boolean;
  running: boolean;
  endpoint: string;
}

async function summarize(project: ProjectMeta): Promise<ProjectSummary> {
  return runWithProject(project.id, async () => {
    const [stats, run, state] = await Promise.all([corpusStats(), readRun(), readServerState()]);
    return {
      ...project,
      sourceCount: stats.docCount,
      indexed: run?.status === 'completed' && (run.totalChunks ?? 0) > 0,
      running: state.running,
      endpoint: state.endpoint,
    };
  });
}

/** Lists the only root entities in the local workspace. */
export async function GET() {
  const workspace = await getProjectWorkspace();
  const projects = await Promise.all(workspace.projects.map(summarize));
  return NextResponse.json({ activeProjectId: workspace.activeProjectId, projects });
}

/** Creates one Project with its single Knowledge API and built-in Assistant configuration. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { name?: string };
  const { project } = await createProject(body.name ?? 'Untitled project');
  return NextResponse.json({ project: await summarize(project) }, { status: 201 });
}

export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { action?: 'activate' | 'rename' | 'reset'; projectId?: string; name?: string; confirmationPath?: string }
    | null;
  if (!body?.action) return NextResponse.json({ error: 'action is required.' }, { status: 400 });

  if (body.action === 'reset') {
    if (!body.confirmationPath) {
      return NextResponse.json({ error: 'confirmationPath is required.' }, { status: 400 });
    }
    await resetLocalProjects(body.confirmationPath);
    return NextResponse.json({ ok: true });
  }
  if (!body.projectId) return NextResponse.json({ error: 'projectId is required.' }, { status: 400 });
  if (body.action === 'activate') {
    return NextResponse.json({ workspace: await setActiveProject(body.projectId) });
  }
  if (body.action === 'rename' && body.name?.trim()) {
    return NextResponse.json({ workspace: await renameProject(body.projectId, body.name) });
  }
  return NextResponse.json({ error: 'Invalid Project action.' }, { status: 400 });
}

export async function DELETE(request: Request) {
  const projectId = new URL(request.url).searchParams.get('id');
  if (!projectId) return NextResponse.json({ error: 'id is required.' }, { status: 400 });
  await runWithProject(projectId, () => stopServer()).catch(() => undefined);
  return NextResponse.json({ workspace: await deleteProject(projectId) });
}
