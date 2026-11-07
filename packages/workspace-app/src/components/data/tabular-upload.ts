export type StructuredFileForTabularUpload = {
  id: string;
  name: string;
  format: 'plain' | 'lines' | 'structured';
  rows?: unknown[];
  indexAsTabular?: boolean;
};

export type SavedTabularDataset = {
  sourceFileId: string;
  id: string;
  fileName: string;
  rowCount: number;
  columnCount: number;
};

type FetchLike = typeof fetch;

/**
 * Save the analytical representation before creating the retrieval document.
 * A structured upload must not silently become text-only: exact joins and
 * aggregations require this durable dataset in addition to indexed chunks.
 */
export async function saveStructuredFilesAsTabularDatasets(
  files: StructuredFileForTabularUpload[],
  groupId: string,
  request: FetchLike,
): Promise<SavedTabularDataset[]> {
  const saved: SavedTabularDataset[] = [];
  for (const file of files) {
    if (file.format !== 'structured' || !file.rows || !file.indexAsTabular) continue;
    const response = await request('/api/tabular', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: file.name, rows: file.rows, groupId }),
    });
    const body = (await response.json().catch(() => null)) as {
      id?: unknown;
      fileName?: unknown;
      rowCount?: unknown;
      columns?: unknown;
      error?: unknown;
    } | null;
    if (!response.ok || typeof body?.id !== 'string') {
      const reason = typeof body?.error === 'string' ? `: ${body.error}` : '';
      throw new Error(`Could not save ${file.name} as an analytical dataset${reason}`);
    }
    saved.push({
      sourceFileId: file.id,
      id: body.id,
      fileName: typeof body.fileName === 'string' ? body.fileName : file.name,
      rowCount: typeof body.rowCount === 'number' ? body.rowCount : file.rows.length,
      columnCount: Array.isArray(body.columns) ? body.columns.length : 0,
    });
  }
  return saved;
}
