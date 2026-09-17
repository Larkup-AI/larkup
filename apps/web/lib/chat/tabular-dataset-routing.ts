import type { TabularDatasetMeta } from '@larkup/core/tabular-store';

function normalized(value: string) {
  return value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function hasColumnMention(text: string, column: string) {
  const query = normalized(text);
  const name = normalized(column);
  if (!query || !name) return false;
  if (query.includes(name)) return true;

  const words = name.split(' ').filter(Boolean);
  return (
    words.length === 1 && words[0].length >= 4 && new RegExp(`\\b${words[0]}\\b`, 'iu').test(query)
  );
}

function isTemporalRequest(text: string) {
  return /\b(?:month(?:ly)?|quarter(?:ly)?|year(?:ly)?|trend|time\s+series|over\s+time)\b/iu.test(
    text,
  );
}

function namesRequestedInText(text: string, dataset: TabularDatasetMeta) {
  return dataset.columns.filter((column) => hasColumnMention(text, column.name));
}

function distinctiveFileNameScore(text: string, fileName: string) {
  const query = normalized(text);
  const fileTerms = normalized(fileName)
    .split(' ')
    .filter(
      (term) => term.length >= 7 && !['sample', 'returns', 'orders', 'people'].includes(term),
    );
  return fileTerms.some((term) => new RegExp(`\\b${term}\\b`, 'iu').test(query)) ? 8 : 0;
}

function scoreDataset(text: string, dataset: TabularDatasetMeta) {
  let score = distinctiveFileNameScore(text, dataset.fileName);
  const temporal = isTemporalRequest(text);
  for (const column of namesRequestedInText(text, dataset)) {
    if (column.type === 'number') score += 6;
    else if (column.type === 'date' && temporal) score += 2;
    else if (/\bby\b/iu.test(text)) score += 3;
  }
  return score;
}

/**
 * Find one unambiguous dataset for code analysis when a model omitted the
 * optional datasetId. This is intentionally schema-led: a matching filename
 * alone is not enough to stage a potentially large source in the sandbox.
 */
export function selectTabularDatasetForQuestion(
  text: string | undefined,
  datasets: TabularDatasetMeta[],
) {
  if (datasets.length === 1) return datasets[0]?.id;
  if (!text) return undefined;

  const candidates = datasets
    .map((dataset) => ({ dataset, score: scoreDataset(text, dataset) }))
    .sort((left, right) => right.score - left.score);
  const best = candidates[0];
  const next = candidates[1];
  if (!best || best.score < 6 || best.score === next?.score) return undefined;
  return best.dataset.id;
}

/**
 * Correct a model-selected sheet only when the question's schema makes a
 * different dataset objectively better. This keeps workbook selection
 * generic while avoiding a filename such as "sales.xlsx" winning over a
 * sheet that actually contains both Sales and Profit.
 */
export function resolveTabularDatasetForQuestion(
  text: string | undefined,
  datasets: TabularDatasetMeta[],
  selectedDatasetId: string,
) {
  const selected = datasets.find((dataset) => dataset.id === selectedDatasetId);
  if (!text || !selected || datasets.length < 2) return selectedDatasetId;

  const selectedScore = scoreDataset(text, selected);
  const resolved = selectTabularDatasetForQuestion(text, datasets);
  if (!resolved || resolved === selectedDatasetId) return selectedDatasetId;
  const best = datasets.find((dataset) => dataset.id === resolved);
  return best && scoreDataset(text, best) > selectedScore ? best.id : selectedDatasetId;
}
