import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import * as XLSX from 'xlsx';
import {
  DEFAULT_CHAT_TABLE_PAGE_SIZE,
  normalizeTableData,
  plainTableLabel,
} from './table-presentation';

export type DataExportFormat = 'xlsx' | 'csv' | 'pdf';

export type DataExportArtifact = {
  success: true;
  fileName: string;
  mimeType: string;
  fileBase64: string;
  rowCount: number;
  format: DataExportFormat;
};

export type DataExportSource = {
  columns: string[];
  rows: Array<Record<string, unknown>>;
};

function usableDataExportSource(source: DataExportSource | undefined) {
  return source?.columns.length && source.rows.length ? source : undefined;
}

/**
 * Select the narrowest authoritative result available for an export. A query
 * completed in the current turn must never be replaced by an older table.
 */
export function selectDataExportSource(input: {
  currentTurnTable?: DataExportSource;
  explicitTable?: DataExportSource;
  recentTable?: DataExportSource;
  recentAnswerText?: string;
}): DataExportSource | undefined {
  const table =
    usableDataExportSource(input.explicitTable) ??
    usableDataExportSource(input.currentTurnTable) ??
    usableDataExportSource(input.recentTable);
  if (table) return table;
  const answer = input.recentAnswerText?.trim();
  return answer ? { columns: ['Answer'], rows: [{ Answer: answer }] } : undefined;
}

const MIME_TYPES: Record<DataExportFormat, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv;charset=utf-8',
  pdf: 'application/pdf',
};

function safeFileStem(value: string | undefined) {
  const cleaned = (value || 'larkup-export')
    .replace(/\.(?:xlsx|csv|pdf)$/i, '')
    .normalize('NFKC')
    .replace(/[^\p{Letter}\p{Number}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return cleaned || 'larkup-export';
}

function csvCell(value: unknown) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildCsv(columns: string[], rows: Array<Record<string, unknown>>) {
  return [
    columns.map(csvCell).join(','),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(',')),
  ].join('\r\n');
}

function wrapPdfText(value: unknown, maxCharacters: number) {
  const text =
    String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim() || '-';
  if (text.length <= maxCharacters) return [text];
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxCharacters) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = word.slice(0, maxCharacters);
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

function pdfSafeText(value: string) {
  return value
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '?');
}

async function buildPdf(title: string, columns: string[], rows: Array<Record<string, unknown>>) {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const landscape = columns.length > 3;
  const pageSize: [number, number] = landscape ? [841.89, 595.28] : [595.28, 841.89];
  const margin = 32;
  const headerHeight = 28;
  const lineHeight = 12;
  const usableWidth = pageSize[0] - margin * 2;
  const columnWidth = usableWidth / Math.max(columns.length, 1);
  const maxCharacters = Math.max(8, Math.floor(columnWidth / 5.5));
  let page = document.addPage(pageSize);
  let y = pageSize[1] - margin;

  const drawHeader = () => {
    page.drawText(pdfSafeText(title.slice(0, 100)), {
      x: margin,
      y,
      size: 15,
      font: bold,
      color: rgb(0.1, 0.13, 0.18),
    });
    y -= 24;
    page.drawRectangle({
      x: margin,
      y: y - headerHeight + 7,
      width: usableWidth,
      height: headerHeight,
      color: rgb(0.94, 0.96, 0.98),
    });
    columns.forEach((column, index) => {
      page.drawText(pdfSafeText(column.slice(0, maxCharacters)), {
        x: margin + index * columnWidth + 5,
        y: y - 10,
        size: 8,
        font: bold,
        color: rgb(0.12, 0.17, 0.24),
      });
    });
    y -= headerHeight;
  };

  drawHeader();
  for (const row of rows) {
    const cells = columns.map((column) => wrapPdfText(row[column], maxCharacters));
    const rowHeight = Math.max(
      lineHeight + 6,
      ...cells.map((lines) => lines.length * lineHeight + 6),
    );
    if (y - rowHeight < margin) {
      page = document.addPage(pageSize);
      y = pageSize[1] - margin;
      drawHeader();
    }
    page.drawLine({
      start: { x: margin, y },
      end: { x: pageSize[0] - margin, y },
      thickness: 0.5,
      color: rgb(0.83, 0.86, 0.9),
    });
    cells.forEach((lines, columnIndex) => {
      lines.forEach((line, lineIndex) => {
        page.drawText(pdfSafeText(line), {
          x: margin + columnIndex * columnWidth + 5,
          y: y - 12 - lineIndex * lineHeight,
          size: 8,
          font: regular,
          color: rgb(0.18, 0.21, 0.26),
        });
      });
    });
    y -= rowHeight;
  }
  return Buffer.from(await document.save());
}

export async function createDataExport(input: {
  format: DataExportFormat;
  fileName?: string;
  title?: string;
  columns: string[];
  rows: Array<Record<string, unknown>>;
}): Promise<DataExportArtifact> {
  const normalized = normalizeTableData(input.columns.slice(0, 50), input.rows.slice(0, 500));
  if (normalized.columns.length === 0 || normalized.rows.length === 0) {
    throw new Error('There is no answer data available to export.');
  }
  const title = plainTableLabel(input.title) || 'Larkup export';
  const fileName = `${safeFileStem(input.fileName || title)}.${input.format}`;
  let bytes: Buffer;

  if (input.format === 'csv') {
    bytes = Buffer.from(`\uFEFF${buildCsv(normalized.columns, normalized.rows)}`, 'utf8');
  } else if (input.format === 'xlsx') {
    const worksheet = XLSX.utils.json_to_sheet(normalized.rows, {
      header: normalized.columns,
      skipHeader: false,
    });
    worksheet['!cols'] = normalized.columns.map((column) => ({
      wch: Math.min(
        48,
        Math.max(
          12,
          column.length + 2,
          ...normalized.rows.slice(0, 100).map((row) => String(row[column] ?? '').length + 2),
        ),
      ),
    }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Answer');
    bytes = Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
  } else {
    bytes = await buildPdf(title, normalized.columns, normalized.rows);
  }

  return {
    success: true,
    fileName,
    mimeType: MIME_TYPES[input.format],
    fileBase64: bytes.toString('base64'),
    rowCount: normalized.rows.length,
    format: input.format,
  };
}

function markdownCells(line: string) {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let current = '';
  let escaped = false;
  for (const character of trimmed) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === '|') {
      cells.push(current.trim());
      current = '';
    } else {
      current += character;
    }
  }
  cells.push(current.trim());
  return cells;
}

function markdownTableFromAnswer(answerText: string): DataExportSource | undefined {
  const lines = answerText.split(/\r?\n/);
  for (let index = 0; index < lines.length - 2; index++) {
    if (!lines[index].includes('|') || !/^\s*\|?\s*:?-{3,}/.test(lines[index + 1])) continue;
    const columns = markdownCells(lines[index]).map(plainTableLabel).filter(Boolean);
    const separator = markdownCells(lines[index + 1]);
    if (
      columns.length === 0 ||
      separator.length !== columns.length ||
      separator.some((cell) => !/^:?-{3,}:?$/.test(cell.replace(/\s+/g, '')))
    ) {
      continue;
    }
    const rows: Array<Record<string, unknown>> = [];
    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex++) {
      if (!lines[rowIndex].includes('|')) break;
      const cells = markdownCells(lines[rowIndex]);
      if (cells.length !== columns.length) break;
      rows.push(Object.fromEntries(columns.map((column, cellIndex) => [column, cells[cellIndex]])));
    }
    if (rows.length) return { columns, rows };
  }
  return undefined;
}

function searchableText(value: unknown) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function rowsMentionedInAnswer(
  source: DataExportSource,
  answerText: string,
): Array<Record<string, unknown>> {
  const answer = ` ${searchableText(answerText)} `;
  if (!answer.trim()) return [];
  const frequencies = new Map<string, number>();
  const searchableRows = source.rows.map((row) =>
    source.columns
      .map((column) => searchableText(row[column]))
      .filter((value) => value.length >= 3),
  );
  for (const values of searchableRows) {
    for (const value of new Set(values)) frequencies.set(value, (frequencies.get(value) ?? 0) + 1);
  }
  return source.rows.filter((_row, rowIndex) =>
    searchableRows[rowIndex].some(
      (value) => frequencies.get(value) === 1 && answer.includes(` ${value} `),
    ),
  );
}

/**
 * Resolve what “export this answer” means without silently expanding it to
 * every row read by the analysis tool. A rendered Markdown table is exact;
 * otherwise answer-mentioned rows win, followed by the table's initial page.
 */
export function answerScopedDataExportSource(input: {
  table?: DataExportSource;
  answerText?: string;
}): DataExportSource | undefined {
  const answerText = input.answerText?.trim() ?? '';
  const markdownTable = answerText ? markdownTableFromAnswer(answerText) : undefined;
  if (markdownTable) return markdownTable;
  if (!input.table?.columns.length || !input.table.rows.length) {
    return answerText ? { columns: ['Answer'], rows: [{ Answer: answerText }] } : undefined;
  }
  const mentionedRows = answerText ? rowsMentionedInAnswer(input.table, answerText) : [];
  return {
    columns: input.table.columns,
    rows:
      mentionedRows.length > 0
        ? mentionedRows
        : input.table.rows.slice(0, DEFAULT_CHAT_TABLE_PAGE_SIZE),
  };
}

export function requestedDataExportFormat(text: string): DataExportFormat | undefined {
  const normalized = text.trim().toLocaleLowerCase();
  const format = /\b(?:excel|xlsx)\b/.test(normalized)
    ? 'xlsx'
    : /\bcsv\b/.test(normalized)
      ? 'csv'
      : /\bpdf\b/.test(normalized)
        ? 'pdf'
        : undefined;
  if (!format) return undefined;
  const asksForFile =
    /\b(?:export|download|save|create|make|generate|prepare|provide|send|give|convert|format)\b/.test(
      normalized,
    ) ||
    /\b(?:as|in|into|to)\s+(?:an?\s+)?(?:excel|xlsx|csv|pdf)\b/.test(normalized) ||
    /^(?:(?:in|as)\s+)?(?:an?\s+)?(?:excel|xlsx|csv|pdf)(?:\s+(?:file|format|table))?(?:\s+(?:maybe|please))?[?!.]*$/.test(
      normalized,
    );
  return asksForFile ? format : undefined;
}
