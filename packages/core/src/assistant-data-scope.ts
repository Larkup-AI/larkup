import type { DataGroup, MediaAsset, SourceDocument } from './types';

/**
 * The Assistant must resolve group availability from the current source of
 * truth for every retrieval. Vector rows and media evidence can outlive a
 * source mutation briefly, so they are never an authorization boundary.
 */
export function isGroupAvailableToAssistant(
  groupId: string | undefined,
  groups: readonly DataGroup[],
): boolean {
  // Older sources without a group belong to Default. Keep them available even
  // if a caller is reading a pre-groups workspace that has no groups file yet.
  if (!groupId || groupId === 'default') {
    const defaultGroup = groups.find((group) => group.id === 'default');
    return defaultGroup?.assistantEnabled !== false;
  }

  // A source pointing at a deleted/unknown group must not become visible just
  // because its old vector or media record still exists.
  const group = groups.find((candidate) => candidate.id === groupId);
  return group !== undefined && group.assistantEnabled !== false;
}

/** Whether a stored source is currently readable by the Project Assistant. */
export function isDocumentAvailableToAssistant(
  document: Pick<SourceDocument, 'enabled' | 'groupId'>,
  groups: readonly DataGroup[],
): boolean {
  return document.enabled !== false && isGroupAvailableToAssistant(document.groupId, groups);
}

/** Whether a media asset is currently readable by the Project Assistant. */
export function isMediaAssetAvailableToAssistant(
  asset: Pick<MediaAsset, 'groupId'>,
  groups: readonly DataGroup[],
): boolean {
  return isGroupAvailableToAssistant(asset.groupId, groups);
}

export function filterDocumentsAvailableToAssistant<
  T extends Pick<SourceDocument, 'enabled' | 'groupId'>,
>(documents: readonly T[], groups: readonly DataGroup[]): T[] {
  return documents.filter((document) => isDocumentAvailableToAssistant(document, groups));
}

export function filterMediaAssetsAvailableToAssistant<T extends Pick<MediaAsset, 'groupId'>>(
  assets: readonly T[],
  groups: readonly DataGroup[],
): T[] {
  return assets.filter((asset) => isMediaAssetAvailableToAssistant(asset, groups));
}
