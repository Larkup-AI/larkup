export interface RemoteMediaEstimate {
  originalUrl: string;
  durationSecs?: number;
  singleItemDurationSecs?: number;
  singleItemUrl?: string;
  entryCount?: number;
}

export function selectedRemoteDuration(
  estimates: RemoteMediaEstimate[] | null,
  singleItem: boolean,
): number {
  return (
    estimates?.reduce(
      (total, estimate) =>
        total +
        (singleItem
          ? (estimate.singleItemDurationSecs ??
            ((estimate.entryCount ?? 1) <= 1 ? estimate.durationSecs : 0) ??
            0)
          : (estimate.durationSecs ?? 0)),
      0,
    ) ?? 0
  );
}

export function selectedRemoteUrls(
  urls: string[],
  estimates: RemoteMediaEstimate[] | null,
  singleItem: boolean,
): string[] {
  if (!singleItem) return urls;
  const estimateByUrl = new Map(estimates?.map((estimate) => [estimate.originalUrl, estimate]));
  return urls.map((url) => {
    const inspectedUrl = estimateByUrl.get(url)?.singleItemUrl;
    if (inspectedUrl) return inspectedUrl;
    try {
      const parsed = new URL(url);
      if (parsed.hostname.includes('youtube.com')) {
        parsed.searchParams.delete('list');
        parsed.searchParams.delete('index');
        return parsed.toString();
      }
    } catch {}
    return url;
  });
}
