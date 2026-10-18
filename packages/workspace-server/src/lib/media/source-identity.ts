const POSITION_PARAMETERS = new Set(['t', 'start', 'time', 'time_continue']);
const PRESENTATION_PARAMETERS = new Set(['si', 'feature']);

/** Identity for one remote media source, independent of seek/tracking parameters. */
export function canonicalMediaSourceUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (
        POSITION_PARAMETERS.has(key.toLocaleLowerCase()) ||
        PRESENTATION_PARAMETERS.has(key.toLocaleLowerCase()) ||
        key.toLocaleLowerCase().startsWith('utm_')
      ) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    return url.toString();
  } catch {
    return trimmed;
  }
}

type EquivalentMediaAsset = {
  id: string;
  originalUrl?: string;
  updatedAt?: string;
  createdAt?: string;
};

/** Resolve duplicate imports of one remote source to the newest indexed asset. */
export function newestEquivalentMediaAsset<T extends EquivalentMediaAsset>(
  asset: T,
  assets: readonly T[],
): T {
  const source = canonicalMediaSourceUrl(asset.originalUrl ?? '');
  if (!source) return asset;
  const timestamp = (candidate: T) => {
    const parsed = Date.parse(candidate.updatedAt ?? candidate.createdAt ?? '');
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return (
    assets
      .filter((candidate) => canonicalMediaSourceUrl(candidate.originalUrl ?? '') === source)
      .sort((left, right) => timestamp(right) - timestamp(left))[0] ?? asset
  );
}
