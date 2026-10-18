import type { TabularDataset } from '@larkup/core/tabular-store';

export type TabularSandboxFile = { name: string; content: string };

export type TabularSandboxManifest = {
  datasets: Array<{
    id: string;
    fileName: string;
    file: string;
    rowCount: number;
    columns: string[];
  }>;
};

function csvCell(value: unknown) {
  const text = String(value ?? '');
  return text.includes(',') || text.includes('"') || text.includes('\n')
    ? `"${text.replace(/"/g, '""')}"`
    : text;
}

/** Serialize a stored dataset with RFC 4180-compatible quoting for sandbox analysis. */
export function tabularDatasetToCsv(dataset: TabularDataset) {
  const columns = dataset.columns.map((column) => column.name);
  return [
    columns.join(','),
    ...dataset.rows.map((row) => columns.map((column) => csvCell(row[column])).join(',')),
  ].join('\n');
}

/**
 * Stage one or more selected datasets for a sandbox without exposing row data
 * to the chat model. A single dataset keeps the long-standing `data.csv`
 * contract; multiple datasets receive stable generic filenames plus a manifest
 * that maps each source ID and sheet name to its CSV file.
 */
export function createTabularSandboxFiles(datasets: TabularDataset[]): {
  files: TabularSandboxFile[];
  manifest?: TabularSandboxManifest;
} {
  if (datasets.length === 0) return { files: [] };

  const multiple = datasets.length > 1;
  const manifest: TabularSandboxManifest = { datasets: [] };
  const files = datasets.map((dataset, index) => {
    const name = multiple ? `dataset-${index + 1}.csv` : 'data.csv';
    manifest.datasets.push({
      id: dataset.id,
      fileName: dataset.fileName,
      file: name,
      rowCount: dataset.rowCount,
      columns: dataset.columns.map((column) => column.name),
    });
    return { name, content: tabularDatasetToCsv(dataset) };
  });

  if (multiple) {
    files.push({ name: 'datasets.json', content: JSON.stringify(manifest, null, 2) });
    return { files, manifest };
  }

  return { files };
}

/**
 * Recover a common single-sheet code pattern when every selected dataset was
 * requested but the generated code still reads `data.csv`. Rewriting is safe
 * only when the number of reads exactly matches the selected datasets.
 */
export function remapLegacyMultiDatasetReads(code: string, datasetCount: number): string {
  if (datasetCount < 2) return code;

  const legacyRead = /pd\s*\.\s*read_(?:csv|excel)\(\s*(['"])data\.csv\1(?:\s*,[^)]*)?\s*\)/g;
  if ([...code.matchAll(legacyRead)].length !== datasetCount) return code;

  let datasetIndex = 0;
  return code.replace(legacyRead, () => `pd.read_csv('dataset-${++datasetIndex}.csv')`);
}
