type Dataset = { id: string; fileName: string; groupId?: string };
type Document = { title: string; groupId?: string; metadata?: { tabularDatasetId?: unknown } };

/** An explicit source link is authoritative over unlinked sidecars of that upload. */
export function filterSupersededTabularDatasets<T extends Dataset>(
  datasets: readonly T[],
  documents: readonly Document[],
): T[] {
  const linkedByUpload = new Map<string, Set<string>>();
  const key = (name: string, groupId?: string) =>
    `${groupId ?? 'default'}\u0000${name.toLocaleLowerCase()}`;
  for (const document of documents) {
    const id = document.metadata?.tabularDatasetId;
    if (typeof id !== 'string' || !datasets.some((dataset) => dataset.id === id)) continue;
    const upload = key(document.title, document.groupId);
    const linked = linkedByUpload.get(upload) ?? new Set<string>();
    linked.add(id);
    linkedByUpload.set(upload, linked);
  }
  return datasets.filter((dataset) => {
    const linked = linkedByUpload.get(key(dataset.fileName, dataset.groupId));
    return !linked || linked.has(dataset.id);
  });
}
