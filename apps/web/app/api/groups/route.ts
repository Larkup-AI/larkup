import { NextResponse } from 'next/server';
import { createGroup, deleteGroup, readGroups, updateGroup } from '@larkup/core/groups-store';
import { runWithProject } from '@larkup/core/project-store';
import { readDocuments } from '@larkup/core/documents-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function withRequestedProject<T>(request: Request, operation: () => Promise<T>): Promise<T> {
  const projectId = new URL(request.url).searchParams.get('projectId');
  return projectId ? runWithProject(projectId, operation) : operation();
}

export async function GET(request: Request) {
  return withRequestedProject(request, async () => {
    const [groups, documents] = await Promise.all([readGroups(), readDocuments()]);
    return NextResponse.json({
      groups: groups.map((group) => ({
        ...group,
        sourceCount: documents.filter(
          (document) =>
            !document.parentSourceId &&
            // Media docs that aren't indexed yet are staging records; exclude them.
            // For indexed media, only count the summary document (not every segment/chapter).
            (document.source !== 'media' || (document.status === 'indexed' && document.metadata?.isMediaSummary === true)) &&
            (document.groupId === group.id || (group.id === 'default' && !document.groupId)),
        ).length,
      })),
      // A Project always has a default group. Older sources without a group belong there.
      ungroupedCount: 0,
    });
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { name?: string; description?: string; icon?: string } | null;
  if (!body?.name?.trim()) return NextResponse.json({ error: 'name is required.' }, { status: 400 });
  return NextResponse.json(
    { group: await createGroup({ name: body.name, description: body.description, icon: body.icon }) },
    { status: 201 },
  );
}

export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    id?: string;
    name?: string;
    description?: string;
    icon?: string;
    assistantEnabled?: boolean;
  } | null;
  if (!body?.id) return NextResponse.json({ error: 'id is required.' }, { status: 400 });
  const group = await updateGroup(body.id, body);
  return group
    ? NextResponse.json({ group })
    : NextResponse.json({ error: 'Group not found.' }, { status: 404 });
}

export async function DELETE(request: Request) {
  const groupId = new URL(request.url).searchParams.get('id');
  if (!groupId) return NextResponse.json({ error: 'id is required.' }, { status: 400 });
  await deleteGroup(groupId);
  return NextResponse.json({ ok: true });
}
