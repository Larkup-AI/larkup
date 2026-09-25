const MARKDOWN_LINK = /!?(?:\[([^\]]+)\])\([^)]*\)/g;

/** Convert model-authored Markdown labels into stable plain table headers. */
export function plainTableLabel(value: unknown): string {
  return String(value ?? '')
    .replace(MARKDOWN_LINK, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/\\([\\`*_{}\[\]()#+.!|>-])/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[*_]+|[*_]+\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Clean headers without collapsing two different source columns to one key. */
export function normalizeTableData(
  columns: string[],
  rows: Array<Record<string, unknown>>,
): { columns: string[]; rows: Array<Record<string, unknown>> } {
  const seen = new Map<string, number>();
  const mappings = columns.map((source, index) => {
    const base = plainTableLabel(source) || `Column ${index + 1}`;
    const occurrence = (seen.get(base) ?? 0) + 1;
    seen.set(base, occurrence);
    return { source, target: occurrence === 1 ? base : `${base} (${occurrence})` };
  });

  return {
    columns: mappings.map(({ target }) => target),
    rows: rows.map((row) =>
      Object.fromEntries(mappings.map(({ source, target }) => [target, row[source]])),
    ),
  };
}
