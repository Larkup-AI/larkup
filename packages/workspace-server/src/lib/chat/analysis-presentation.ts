import type { TabularDataset } from '@larkup/core/tabular-store';

const PRESENTATION_MARKER = '__LARKUP_PRESENTATION__:';
const MAX_PRESENTATION_CHARS = 3_000_000;
const MAX_TABLE_ROWS = 5_000;
const MAX_TABLE_COLUMNS = 50;
const MAX_CELL_CHARS = 20_000;
const MAX_DOCUMENT_PAGES = 1_000;

export interface AnalysisTablePresentation {
  kind: 'table';
  title: string;
  summary?: string;
  columns: string[];
  rows: Array<Record<string, string | number | boolean | null>>;
  totalItems: number;
  requestedItems?: number;
  complete: boolean;
  fileName?: string;
}

export interface AnalysisDocumentPage {
  title?: string;
  content: string;
}

export interface AnalysisDocumentPresentation {
  kind: 'document';
  title: string;
  summary?: string;
  pages: AnalysisDocumentPage[];
  totalItems: number;
  requestedItems?: number;
  complete: boolean;
  fileName?: string;
}

export type AnalysisPresentation = AnalysisTablePresentation | AnalysisDocumentPresentation;

/**
 * Give the answering model a compact copy of successful structured output.
 * UI artifacts can paginate documents, but the final answer still needs every
 * requested number rather than inventing values from the first visible page.
 */
export function analysisPresentationEvidence(
  presentation: AnalysisPresentation | undefined,
  maximumChars = 4_500,
): string {
  if (!presentation) return '';
  const lines = [
    'Complete analysis artifact evidence (use these values in the final answer):',
    presentation.title,
    ...(presentation.summary ? [presentation.summary] : []),
  ];
  if (presentation.kind === 'table') {
    lines.push(presentation.columns.join('\t'));
    for (const row of presentation.rows) {
      lines.push(presentation.columns.map((column) => String(row[column] ?? '')).join('\t'));
    }
  } else {
    for (const page of presentation.pages) {
      if (page.title) lines.push(page.title);
      lines.push(page.content);
    }
  }
  return lines.join('\n').slice(0, maximumChars);
}

function requestMentionsEntity(requestText: string, entity: string) {
  const escaped = entity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}(?:s|es)?\\b`, 'iu').test(requestText);
}

/**
 * Add unambiguous dimension labels and presentation precision without changing
 * the underlying calculation. Generated analysis often returns a correct
 * `site_id` ranking while omitting the requested human-readable site name.
 */
export function normalizeAnalysisPresentationForRequest(
  requestText: string,
  presentation: AnalysisPresentation | undefined,
  datasets: TabularDataset[],
): AnalysisPresentation | undefined {
  if (!presentation || presentation.kind !== 'table') return presentation;

  let columns = [...presentation.columns];
  let rows = presentation.rows.map((row) => ({ ...row }));
  for (const idColumn of presentation.columns.filter((column) => /_id$/i.test(column))) {
    const entity = idColumn.replace(/_id$/i, '');
    const nameColumn = `${entity}_name`;
    if (columns.includes(nameColumn) || !requestMentionsEntity(requestText, entity)) continue;
    const dimensions = datasets.filter(
      (dataset) =>
        dataset.columns.some((column) => column.name === idColumn) &&
        dataset.columns.some((column) => column.name === nameColumn),
    );
    if (dimensions.length !== 1) continue;
    const labels = new Map(
      dimensions[0].rows
        .filter((row) => row[idColumn] !== null && row[idColumn] !== undefined)
        .map((row) => [String(row[idColumn]), normalizeCell(row[nameColumn])]),
    );
    if (!rows.every((row) => labels.has(String(row[idColumn])))) continue;
    const idIndex = columns.indexOf(idColumn);
    columns.splice(idIndex + 1, 0, nameColumn);
    rows = rows.map((row) => ({ ...row, [nameColumn]: labels.get(String(row[idColumn])) ?? null }));
  }

  const explicitPrecision = requestText.match(/\b(\d+)\s+decimal\s+places?\b/i);
  const decimals = explicitPrecision ? Number(explicitPrecision[1]) : 1;
  if (Number.isInteger(decimals) && decimals >= 0 && decimals <= 8) {
    const scale = 10 ** decimals;
    for (const column of columns.filter((name) => /percent(?:age)?|\bpct\b/i.test(name))) {
      rows = rows.map((row) => ({
        ...row,
        [column]:
          typeof row[column] === 'number' && Number.isFinite(row[column])
            ? Math.round(row[column] * scale) / scale
            : row[column],
      }));
    }
  }

  return { ...presentation, columns, rows };
}

function boundedText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text ? text.slice(0, max) : undefined;
}

function boundedCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

function normalizeCell(value: unknown): string | number | boolean | null {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.slice(0, MAX_CELL_CHARS);
  try {
    const serialized = JSON.stringify(value);
    return (serialized ?? String(value)).slice(0, MAX_CELL_CHARS);
  } catch {
    return String(value).slice(0, MAX_CELL_CHARS);
  }
}

function normalizeTable(value: Record<string, unknown>): AnalysisTablePresentation | undefined {
  if (!Array.isArray(value.rows)) return undefined;
  const inferredColumns = value.rows.flatMap((row) =>
    row && typeof row === 'object' && !Array.isArray(row) ? Object.keys(row) : [],
  );
  const columns = [
    ...new Set(
      (Array.isArray(value.columns) ? value.columns : inferredColumns).filter(
        (column): column is string => typeof column === 'string' && column.trim().length > 0,
      ),
    ),
  ]
    .slice(0, MAX_TABLE_COLUMNS)
    .map((column) => column.slice(0, 160));
  if (columns.length === 0) return undefined;

  const rows: AnalysisTablePresentation['rows'] = [];
  let serializedChars = 0;
  for (const candidate of value.rows) {
    if (rows.length >= MAX_TABLE_ROWS || serializedChars >= MAX_PRESENTATION_CHARS) break;
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const source = candidate as Record<string, unknown>;
    const row = Object.fromEntries(
      columns.map((column) => [column, normalizeCell(source[column])]),
    );
    const rowChars = JSON.stringify(row).length;
    if (serializedChars + rowChars > MAX_PRESENTATION_CHARS) break;
    rows.push(row);
    serializedChars += rowChars;
  }
  if (rows.length === 0) return undefined;

  const requestedItems = boundedCount(value.requestedItems);
  const reportedTotal = boundedCount(value.totalItems) ?? value.rows.length;
  const totalItems = Math.max(reportedTotal, rows.length);
  const retainedEveryRow = rows.length === value.rows.length;
  const satisfiesRequest = requestedItems === undefined || rows.length >= requestedItems;
  return {
    kind: 'table',
    title: boundedText(value.title, 160) ?? 'Analysis results',
    ...(boundedText(value.summary, 800) ? { summary: boundedText(value.summary, 800) } : {}),
    columns,
    rows,
    totalItems,
    ...(requestedItems !== undefined ? { requestedItems } : {}),
    complete: value.complete !== false && retainedEveryRow && satisfiesRequest,
    ...(boundedText(value.fileName, 120) ? { fileName: boundedText(value.fileName, 120) } : {}),
  };
}

function normalizeDocument(
  value: Record<string, unknown>,
): AnalysisDocumentPresentation | undefined {
  if (!Array.isArray(value.pages)) return undefined;
  const pages: AnalysisDocumentPage[] = [];
  let serializedChars = 0;
  for (const candidate of value.pages) {
    if (pages.length >= MAX_DOCUMENT_PAGES || serializedChars >= MAX_PRESENTATION_CHARS) break;
    const page =
      typeof candidate === 'string'
        ? { content: candidate }
        : candidate && typeof candidate === 'object' && !Array.isArray(candidate)
          ? (candidate as Record<string, unknown>)
          : undefined;
    const content = boundedText(page?.content, MAX_CELL_CHARS);
    if (!content || serializedChars + content.length > MAX_PRESENTATION_CHARS) break;
    const title = boundedText(page?.title, 160);
    pages.push({ ...(title ? { title } : {}), content });
    serializedChars += content.length;
  }
  if (pages.length === 0) return undefined;

  const requestedItems = boundedCount(value.requestedItems);
  const reportedTotal = boundedCount(value.totalItems) ?? value.pages.length;
  const totalItems = Math.max(reportedTotal, pages.length);
  const retainedEveryPage = pages.length === value.pages.length;
  const satisfiesRequest = requestedItems === undefined || pages.length >= requestedItems;
  return {
    kind: 'document',
    title: boundedText(value.title, 160) ?? 'Prepared document',
    ...(boundedText(value.summary, 800) ? { summary: boundedText(value.summary, 800) } : {}),
    pages,
    totalItems,
    ...(requestedItems !== undefined ? { requestedItems } : {}),
    complete: value.complete !== false && retainedEveryPage && satisfiesRequest,
    ...(boundedText(value.fileName, 120) ? { fileName: boundedText(value.fileName, 120) } : {}),
  };
}

export function extractAnalysisPresentation(stdout: string): {
  stdout: string;
  presentation?: AnalysisPresentation;
} {
  const markerIndex = stdout.lastIndexOf(PRESENTATION_MARKER);
  if (markerIndex < 0) return { stdout };
  const payloadStart = markerIndex + PRESENTATION_MARKER.length;
  const lineEnd = stdout.indexOf('\n', payloadStart);
  const payload = stdout.slice(payloadStart, lineEnd < 0 ? undefined : lineEnd).trim();
  const cleanedStdout =
    `${stdout.slice(0, markerIndex)}${lineEnd < 0 ? '' : stdout.slice(lineEnd + 1)}`.trim();
  if (!payload || payload.length > MAX_PRESENTATION_CHARS * 2) return { stdout: cleanedStdout };
  try {
    const value = JSON.parse(payload) as Record<string, unknown>;
    const presentation =
      value?.kind === 'table'
        ? normalizeTable(value)
        : value?.kind === 'document'
          ? normalizeDocument(value)
          : undefined;
    return { stdout: cleanedStdout, ...(presentation ? { presentation } : {}) };
  } catch {
    return { stdout: cleanedStdout };
  }
}

/** Injected before generated Python so long results have one stable UI contract. */
export const ANALYSIS_PRESENTATION_PYTHON = String.raw`
import json as _larkup_json

_LARKUP_PRESENTATION_EMITTED = False

def _larkup_json_default(value):
    item = getattr(value, "item", None)
    if callable(item):
        try:
            return item()
        except Exception:
            pass
    return str(value)

_larkup_original_json_dumps = _larkup_json.dumps

def _larkup_safe_json_dumps(*args, **kwargs):
    kwargs.setdefault("default", _larkup_json_default)
    return _larkup_original_json_dumps(*args, **kwargs)

_larkup_json.dumps = _larkup_safe_json_dumps

def _larkup_print_result(value):
    if isinstance(value, dict):
        for key, item in value.items():
            print(f"{key}:")
            _larkup_print_result(item)
        return
    if isinstance(value, tuple) and any(callable(getattr(item, "to_string", None)) for item in value):
        for item in value:
            _larkup_print_result(item)
        return
    to_string = getattr(value, "to_string", None)
    if callable(to_string):
        try:
            display_value = value
            columns = getattr(value, "columns", None)
            if columns is not None:
                display_value = value.copy()
                for column in columns:
                    normalized_column = str(column).lower().replace("_", " ")
                    if "percent" in normalized_column or "percentage" in normalized_column:
                        try:
                            display_value[column] = display_value[column].round(1)
                        except Exception:
                            pass
            print(display_value.to_string(index=False))
            return
        except TypeError:
            try:
                print(to_string())
                return
            except Exception:
                pass
    print(repr(value))

def larkup_table(title, rows, columns=None, summary=None, requested_items=None, file_name=None):
    global _LARKUP_PRESENTATION_EMITTED
    if hasattr(rows, "to_dict"):
        rows = rows.to_dict(orient="records")
    rows = list(rows)
    if columns is None:
        columns = list(rows[0].keys()) if rows else []
    columns = list(columns)
    if rows and not isinstance(rows[0], dict) and isinstance(rows[0], (list, tuple)):
        rows = [dict(zip(columns, row)) for row in rows]
    requested_items = requested_items if isinstance(requested_items, int) and not isinstance(requested_items, bool) and requested_items > 0 else _LARKUP_REQUESTED_ITEMS
    payload = {
        "kind": "table", "title": title, "summary": summary,
        "columns": columns, "rows": rows, "totalItems": len(rows),
        "requestedItems": requested_items, "complete": True, "fileName": file_name,
    }
    print("${PRESENTATION_MARKER}" + _larkup_json.dumps(payload, ensure_ascii=False, default=_larkup_json_default))
    _LARKUP_PRESENTATION_EMITTED = True

def larkup_document(title, pages, summary=None, requested_items=None, file_name=None):
    global _LARKUP_PRESENTATION_EMITTED
    pages = list(pages)
    requested_items = requested_items if isinstance(requested_items, int) and not isinstance(requested_items, bool) and requested_items > 0 else _LARKUP_REQUESTED_ITEMS
    payload = {
        "kind": "document", "title": title, "summary": summary,
        "pages": pages, "totalItems": len(pages), "requestedItems": requested_items,
        "complete": True, "fileName": file_name,
    }
    print("${PRESENTATION_MARKER}" + _larkup_json.dumps(payload, ensure_ascii=False, default=_larkup_json_default))
    _LARKUP_PRESENTATION_EMITTED = True

def _larkup_auto_present():
    if _LARKUP_PRESENTATION_EMITTED or _LARKUP_REQUESTED_ITEMS is None:
        return
    scope = globals()
    value = None
    for name in ("rows", "results", "final_results", "output_rows", "recommendations", "matches_summary", "matches", "output", "result"):
        candidate = scope.get(name)
        if candidate is not None and not isinstance(candidate, (str, bytes, dict)):
            try:
                if len(candidate) > 0:
                    value = candidate
                    break
            except Exception:
                pass
    if value is None:
        return
    if hasattr(value, "to_dict"):
        value = value.to_dict(orient="records")
    else:
        value = list(value)
    if not value:
        return
    if all(isinstance(item, str) for item in value):
        larkup_document("Prepared analysis", value, requested_items=_LARKUP_REQUESTED_ITEMS)
        return
    columns = scope.get("columns")
    if not isinstance(columns, (list, tuple)) or not all(isinstance(item, str) for item in columns):
        columns = list(value[0].keys()) if isinstance(value[0], dict) else []
    larkup_table("Prepared analysis", value, columns=list(columns), requested_items=_LARKUP_REQUESTED_ITEMS)
`;

export function withAnalysisPresentationHelpers(code: string, requestedItems?: number): string {
  const requested = requestedItems === undefined ? 'None' : String(requestedItems);
  const sanitizedCode = code
    .replace(/^\s*import\s+functions\s*(?:#.*)?$/gm, '')
    .replace(/\bfunctions\s*\.\s*larkup_(table|document)\s*\(/g, 'larkup_$1(')
    .replace(/^\s*import\s+larkup_(?:table|document)(?:\s+as\s+\w+)?\s*(?:#.*)?$/gm, '')
    .replace(/^\s*import\s+larkup(?:\s+as\s+\w+)?\s*(?:#.*)?$/gm, '')
    .replace(
      /^\s*from\s+larkup_(?:table|document)\s+import\s+larkup_(?:table|document)\s*(?:#.*)?$/gm,
      '',
    )
    .replace(
      /^\s*from\s+larkup\s+import\s+larkup_(?:table|document)(?:\s*,\s*larkup_(?:table|document))*\s*(?:#.*)?$/gm,
      '',
    )
    .replace(/\blarkup_table\s*\.\s*larkup_table\s*\(/g, 'larkup_table(')
    .replace(/\blarkup_document\s*\.\s*larkup_document\s*\(/g, 'larkup_document(')
    .replace(/\blarkup\s*\.\s*larkup_table\s*\(/g, 'larkup_table(')
    .replace(/\blarkup\s*\.\s*larkup_document\s*\(/g, 'larkup_document(');
  return `${ANALYSIS_PRESENTATION_PYTHON}\n_LARKUP_REQUESTED_ITEMS = ${requested}\n${sanitizedCode}\n_larkup_auto_present()`;
}
