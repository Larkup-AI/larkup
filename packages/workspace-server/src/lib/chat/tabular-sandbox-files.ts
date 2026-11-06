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

/** Serialize an in-memory result table so a later analysis can use it as its exact input. */
export function tabularRowsToCsv(columns: string[], rows: Array<Record<string, unknown>>) {
  return [
    columns.map(csvCell).join(','),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(',')),
  ].join('\n');
}

/** Serialize a stored dataset with RFC 4180-compatible quoting for sandbox analysis. */
export function tabularDatasetToCsv(dataset: TabularDataset) {
  const columns = dataset.columns.map((column) => column.name);
  return tabularRowsToCsv(columns, dataset.rows);
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

/**
 * Repoint literal filenames generated from visible dataset metadata to the
 * generic files mounted in the sandbox. Exact filename or dataset-ID matches
 * are required, so unrelated external paths remain untouched.
 */
export function remapMountedDatasetReads(
  code: string,
  manifest: TabularSandboxManifest | undefined,
): string {
  if (!manifest || manifest.datasets.length < 2) return code;
  const mountedByReference = new Map<string, string>();
  for (const dataset of manifest.datasets) {
    mountedByReference.set(dataset.fileName.toLocaleLowerCase(), dataset.file);
    mountedByReference.set(`${dataset.id}.csv`.toLocaleLowerCase(), dataset.file);
    mountedByReference.set(dataset.file.toLocaleLowerCase(), dataset.file);
  }
  const reader = /(\b(?:pd|pandas)\s*\.\s*read_(?:csv|excel)\(\s*)(['"])([^'"]+)\2/g;
  return code.replace(reader, (match, prefix: string, quote: string, path: string) => {
    const baseName = path.split(/[\\/]/).at(-1)?.toLocaleLowerCase() ?? '';
    const mounted = mountedByReference.get(baseName);
    return mounted ? `${prefix}${quote}${mounted}${quote}` : match;
  });
}

/** Repoint only the first model-authored input read to the staged source. */
export function remapSingleDatasetRead(code: string): string {
  const firstCsvRead = /\b(?:pd|pandas)\s*\.\s*read_csv\(\s*(?:(["'])[^"']*\1|[A-Za-z_]\w*)/;
  return code.replace(firstCsvRead, (match) => {
    const open = match.slice(0, match.indexOf('(') + 1);
    return `${open}'data.csv'`;
  });
}

function decodeSimplePythonString(value: string) {
  return value.replace(/\\([\\'\"])/g, '$1');
}

function normalizedColumnName(value: string) {
  return value
    .toLocaleLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchingSchemaColumn(authored: string, columns: string[]) {
  const normalizedAuthored = normalizedColumnName(authored);
  if (normalizedAuthored.length < 12) return undefined;
  const authoredTokens = new Set(normalizedAuthored.split(' ').filter((token) => token.length > 2));
  const candidates = columns.filter((column) => {
    const normalizedColumn = normalizedColumnName(column);
    if (normalizedColumn === normalizedAuthored) return true;
    if (
      normalizedAuthored.length >= 18 &&
      (normalizedColumn.startsWith(normalizedAuthored) ||
        normalizedColumn.endsWith(normalizedAuthored) ||
        normalizedAuthored.startsWith(normalizedColumn) ||
        normalizedAuthored.endsWith(normalizedColumn))
    ) {
      return true;
    }
    const columnTokens = new Set(normalizedColumn.split(' ').filter((token) => token.length > 2));
    const shared = [...authoredTokens].filter((token) => columnTokens.has(token)).length;
    return shared >= 4 && shared / Math.min(authoredTokens.size, columnTokens.size) >= 0.8;
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}

/**
 * Repair model-authored column references only when they map unambiguously to
 * one real column. Form exports commonly wrap a short question in a much
 * longer heading, and generated Python may also quote apostrophes incorrectly.
 */
export function remapSingleDatasetColumnReferences(code: string, dataset: TabularDataset) {
  const columns = dataset.columns.map((column) => column.name);
  const stringLiteral = /(['"])((?:\\.|(?!\1)[^\\])*)\1/g;

  // A form-export header can contain the same apostrophe or quote a model used
  // to delimit it, leaving otherwise reasonable code syntactically invalid.
  // Replace only exact, known schema labels before parsing ordinary literals.
  let repairedCode = code;
  for (const column of columns) {
    const safeLiteral = JSON.stringify(column);
    repairedCode = repairedCode.split(`'${column}'`).join(safeLiteral);
    repairedCode = repairedCode.split(`"${column}"`).join(safeLiteral);
  }

  // Recover malformed quoted entries in Python lists. The closing quote must
  // be followed by a list delimiter, so apostrophes inside contractions do not
  // terminate the candidate early.
  const tolerantListLiteral = /(^|,\s*)(['"])((?:\\.|[\s\S]){1,2000}?)\2(?=\s*(?:,|$))/g;
  repairedCode = repairedCode.replace(/\[\[([\s\S]{1,10000}?)\]\]/g, (selection) =>
    selection.replace(
      tolerantListLiteral,
      (literal, prefix: string, _quote: string, encoded: string) => {
        const column = matchingSchemaColumn(decodeSimplePythonString(encoded), columns);
        return column ? `${prefix}${JSON.stringify(column)}` : literal;
      },
    ),
  );

  return repairedCode.replace(stringLiteral, (literal, _quote: string, encoded: string) => {
    const authored = decodeSimplePythonString(encoded);
    if (columns.includes(authored)) return literal;
    const column = matchingSchemaColumn(authored, columns);
    return column ? JSON.stringify(column) : literal;
  });
}
