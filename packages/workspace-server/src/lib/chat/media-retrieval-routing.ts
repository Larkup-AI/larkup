type RetrievalHit = {
  documentId?: unknown;
  metadata?: { mediaAssetId?: unknown };
};

/** Route to media analysis only when the best-ranked source is itself media. */
export function leadingMediaAssetId(
  retrieval: { hits?: RetrievalHit[] },
  activeAssetIds: ReadonlySet<string>,
  assetIdByDocumentId: ReadonlyMap<string, string>,
): string | undefined {
  const leadingHit = retrieval.hits?.[0];
  if (!leadingHit) return undefined;

  const directAssetId = leadingHit.metadata?.mediaAssetId;
  if (typeof directAssetId === 'string' && activeAssetIds.has(directAssetId)) {
    return directAssetId;
  }
  return assetIdByDocumentId.get(String(leadingHit.documentId ?? ''));
}

/** Read only an explicitly routed media source, never metadata on secondary search hits. */
export function explicitMediaEvidenceAssetId(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = explicitMediaEvidenceAssetId(item);
      if (found) return found;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.mediaAssetId === 'string' && record.mediaAssetId.trim()) {
    return record.mediaAssetId;
  }
  return explicitMediaEvidenceAssetId(record.videoEvidence);
}

/** A deterministic gate before an answer model is allowed to compose prose. */
export function hasRetrievedSourceEvidence(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as { hits?: unknown };
  return (
    (Array.isArray(record.hits) && record.hits.length > 0) ||
    Boolean(explicitMediaEvidenceAssetId(value))
  );
}
