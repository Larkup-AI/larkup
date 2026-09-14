import { NextResponse } from 'next/server';
import { updateDocumentsGroup } from '@larkup/core/documents-store';
import { updateMediaAssetsGroup } from '@larkup/core/media-store';
import { resolveGroupId } from '@larkup/core/groups-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function collectIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(value.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)),
  ];
}

/** PATCH → move selected source records into one validated data group. */
export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    documentIds?: unknown;
    mediaAssetIds?: unknown;
    groupId?: unknown;
  } | null;
  const documentIds = collectIds(body?.documentIds);
  const mediaAssetIds = collectIds(body?.mediaAssetIds);

  if (documentIds.length === 0 && mediaAssetIds.length === 0) {
    return NextResponse.json({ error: 'Select at least one source to move.' }, { status: 400 });
  }
  if (typeof body?.groupId !== 'string') {
    return NextResponse.json({ error: 'groupId is required.' }, { status: 400 });
  }

  const groupId = await resolveGroupId(body.groupId);
  const [documents, mediaAssets] = await Promise.all([
    updateDocumentsGroup(documentIds, groupId),
    updateMediaAssetsGroup(mediaAssetIds, groupId),
  ]);
  return NextResponse.json({
    groupId,
    movedCount: documents.length + mediaAssets.length,
    documents,
    mediaAssets,
  });
}
