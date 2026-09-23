import { NextResponse } from 'next/server';
import { updateDocumentsGroup } from '@larkup/core/documents-store';
import { readMediaAssets, updateMediaAssetsGroup } from '@larkup/core/media-store';
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
  // Media source state is split between the asset and its derived documents.
  // Always move both sides together, including for API callers that selected
  // only one side. Otherwise the unchanged side can remain retrievable via a
  // stale vector/evidence path after the visible source was moved.
  const requestedDocumentIds = new Set(documentIds);
  const requestedMediaAssetIds = new Set(mediaAssetIds);
  const relatedMediaAssets = (await readMediaAssets()).filter(
    (asset) =>
      requestedMediaAssetIds.has(asset.id) ||
      asset.documentIds.some((documentId) => requestedDocumentIds.has(documentId)) ||
      asset.pendingDocumentIds?.some((documentId) => requestedDocumentIds.has(documentId)) ||
      asset.supersededDocumentIds?.some((documentId) => requestedDocumentIds.has(documentId)),
  );
  const relatedDocumentIds = relatedMediaAssets.flatMap((asset) => [
    ...asset.documentIds,
    ...(asset.pendingDocumentIds ?? []),
    ...(asset.supersededDocumentIds ?? []),
  ]);
  const allDocumentIds = [...new Set([...documentIds, ...relatedDocumentIds])];
  const allMediaAssetIds = [
    ...new Set([...mediaAssetIds, ...relatedMediaAssets.map((asset) => asset.id)]),
  ];
  const [documents, mediaAssets] = await Promise.all([
    updateDocumentsGroup(allDocumentIds, groupId),
    updateMediaAssetsGroup(allMediaAssetIds, groupId),
  ]);
  return NextResponse.json({
    groupId,
    movedCount: documents.length + mediaAssets.length,
    documents,
    mediaAssets,
  });
}
