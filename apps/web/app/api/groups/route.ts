import { NextResponse } from 'next/server';
import { createGroup, deleteGroup, readGroups, updateGroup } from '@larkup/core/groups-store';
import { runWithProject } from '@larkup/core/project-store';
import { readDocuments } from '@larkup/core/documents-store';
import { readMediaAssets } from '@larkup/core/media-store';
import { readJobs } from '@larkup/core/jobs-store';
import { listTabularDatasets, resolveTabularDatasetGroups } from '@larkup/core/tabular-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function withRequestedProject<T>(request: Request, operation: () => Promise<T>): Promise<T> {
  const projectId = new URL(request.url).searchParams.get('projectId');
  return projectId ? runWithProject(projectId, operation) : operation();
}

export async function GET(request: Request) {
  return withRequestedProject(request, async () => {
    const [groups, documents, mediaAssets] = await Promise.all([
      readGroups(),
      readDocuments(),
      readMediaAssets(),
    ]);
    return NextResponse.json({
      groups: groups.map((group) => ({
        ...group,
        sourceCount:
          documents.filter(
            (document) =>
              !document.parentSourceId &&
              document.source !== 'media' &&
              (document.groupId ?? 'default') === group.id,
          ).length +
          mediaAssets.filter((asset) => (asset.groupId ?? 'default') === group.id).length,
      })),
      // A Project always has a default group. Older sources without a group belong there.
      ungroupedCount: 0,
    });
  });
}

export async function POST(request: Request) {
  return withRequestedProject(request, async () => {
    const body = (await request.json().catch(() => null)) as {
      name?: string;
      description?: string;
      icon?: string;
    } | null;
    if (!body?.name?.trim())
      return NextResponse.json({ error: 'name is required.' }, { status: 400 });
    return NextResponse.json(
      {
        group: await createGroup({
          name: body.name,
          description: body.description,
          icon: body.icon,
        }),
      },
      { status: 201 },
    );
  });
}

export async function PATCH(request: Request) {
  return withRequestedProject(request, async () => {
    const body = (await request.json().catch(() => null)) as {
      id?: string;
      name?: string;
      description?: string;
      icon?: string;
      assistantEnabled?: boolean;
    } | null;
    if (!body?.id) return NextResponse.json({ error: 'id is required.' }, { status: 400 });
    if (body.name !== undefined && !body.name.trim()) {
      return NextResponse.json({ error: 'name cannot be empty.' }, { status: 400 });
    }
    const group = await updateGroup(body.id, body);
    return group
      ? NextResponse.json({ group })
      : NextResponse.json({ error: 'Group not found.' }, { status: 404 });
  });
}

export async function DELETE(request: Request) {
  return withRequestedProject(request, async () => {
    const groupId = new URL(request.url).searchParams.get('id');
    if (!groupId) return NextResponse.json({ error: 'id is required.' }, { status: 400 });
    const groups = await readGroups();
    const group = groups.find((candidate) => candidate.id === groupId);
    if (!group) return NextResponse.json({ error: 'Group not found.' }, { status: 404 });
    if (groupId === 'default') {
      return NextResponse.json({ error: 'The Default group cannot be deleted.' }, { status: 400 });
    }

    const [documents, mediaAssets, datasets, jobs] = await Promise.all([
      readDocuments(),
      readMediaAssets(),
      listTabularDatasets(),
      readJobs(),
    ]);
    const resolvedDatasets = resolveTabularDatasetGroups(datasets, documents);
    const hasStoredData =
      documents.some((document) => (document.groupId ?? 'default') === groupId) ||
      mediaAssets.some((asset) => (asset.groupId ?? 'default') === groupId) ||
      resolvedDatasets.some((dataset) => (dataset.groupId ?? 'default') === groupId);
    const hasActiveJob = jobs.some(
      (job) =>
        (job.groupId ?? 'default') === groupId &&
        (job.status === 'queued' || job.status === 'running'),
    );
    if (hasStoredData || hasActiveJob) {
      return NextResponse.json(
        {
          error: hasActiveJob
            ? 'Wait for active imports to finish, then move or delete this group’s sources.'
            : 'Move or delete this group’s sources before deleting the group.',
        },
        { status: 409 },
      );
    }
    await deleteGroup(groupId);
    return NextResponse.json({ ok: true });
  });
}
