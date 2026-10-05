import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import * as XLSX from 'xlsx';
import { normalizeTableData, plainTableLabel } from './table-presentation';

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
    usableDataExportSource(input.currentTurnTable) ??
    usableDataExportSource(input.explicitTable) ??
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
    if (word.length > maxCharacters) {
      if (line) {
        lines.push(line);
        line = '';
      }
      for (let offset = 0; offset < word.length; offset += maxCharacters) {
        const chunk = word.slice(offset, offset + maxCharacters);
        if (chunk.length === maxCharacters) lines.push(chunk);
        else line = chunk;
      }
      continue;
    }
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxCharacters) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = word.slice(0, maxCharacters);
  }
  if (line) lines.push(line);
  return lines;
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
    const totalLines = Math.max(1, ...cells.map((lines) => lines.length));
    let lineOffset = 0;

    while (lineOffset < totalLines) {
      const availableLines = Math.max(0, Math.floor((y - margin - 6) / lineHeight));
      if (availableLines === 0) {
        page = document.addPage(pageSize);
        y = pageSize[1] - margin;
        drawHeader();
        continue;
      }
      const linesOnPage = Math.min(totalLines - lineOffset, availableLines);
      const rowHeight = Math.max(lineHeight + 6, linesOnPage * lineHeight + 6);
      page.drawLine({
        start: { x: margin, y },
        end: { x: pageSize[0] - margin, y },
        thickness: 0.5,
        color: rgb(0.83, 0.86, 0.9),
      });
      cells.forEach((lines, columnIndex) => {
        lines.slice(lineOffset, lineOffset + linesOnPage).forEach((line, lineIndex) => {
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
      lineOffset += linesOnPage;
      if (lineOffset < totalLines) {
        page = document.addPage(pageSize);
        y = pageSize[1] - margin;
        drawHeader();
      }
    }
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

const answerMarkdownLink = /!?(?:\[([^\]]+)\])\([^)]*\)/g;

function plainAnswerBlock(value: string) {
  return value
    .replace(answerMarkdownLink, '$1')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*[-*+][ \t]+/gm, '- ')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Turn a rendered prose/list answer into complete, independently exportable rows. */
function answerListSource(answerText: string): DataExportSource | undefined {
  const horizontalRuleBlocks = answerText
    .split(/\r?\n\s*(?:-{3,}|_{3,}|\*{3,})\s*\r?\n/g)
    .map(plainAnswerBlock)
    .filter(Boolean);
  if (horizontalRuleBlocks.length > 1) {
    return {
      columns: ['Answer'],
      rows: horizontalRuleBlocks.map((Answer) => ({ Answer })),
    };
  }

  const lines = answerText.split(/\r?\n/);
  const listItems = lines.flatMap((line, index) => {
    const match = line.match(/^([ \t]*)(?:[-*+]\s+|\d+[.)]\s+)/);
    return match ? [{ index, indent: match[1].replace(/\t/g, '  ').length }] : [];
  });
  const minimumIndent = Math.min(...listItems.map((item) => item.indent));
  const listStarts = listItems
    .filter((item) => item.indent === minimumIndent)
    .map((item) => item.index);
  if (listStarts.length > 1) {
    const rows = listStarts.map((start, position) => {
      const end = listStarts[position + 1] ?? lines.length;
      return plainAnswerBlock(lines.slice(start, end).join('\n'));
    });
    return { columns: ['Answer'], rows: rows.filter(Boolean).map((Answer) => ({ Answer })) };
  }

  const paragraphBlocks = answerText
    .split(/\r?\n\s*\r?\n/g)
    .map(plainAnswerBlock)
    .filter(Boolean);
  if (paragraphBlocks.length > 1) {
    return {
      columns: ['Answer'],
      rows: paragraphBlocks.map((Answer) => ({ Answer })),
    };
  }
  return undefined;
}

/**
 * Resolve what “export this answer” means without silently expanding it to
 * unrelated source data. Rendered tables and lists are exact; otherwise
 * answer-mentioned rows win, followed by the complete bounded query result.
 */
export function answerScopedDataExportSource(input: {
  table?: DataExportSource;
  answerText?: string;
}): DataExportSource | undefined {
  const answerText = input.answerText?.trim() ?? '';
  const markdownTable = answerText ? markdownTableFromAnswer(answerText) : undefined;
  if (markdownTable) return markdownTable;
  const answerList = answerText ? answerListSource(answerText) : undefined;
  if (answerList) return answerList;
  if (!input.table?.columns.length || !input.table.rows.length) {
    return answerText ? { columns: ['Answer'], rows: [{ Answer: answerText }] } : undefined;
  }
  const mentionedRows = answerText ? rowsMentionedInAnswer(input.table, answerText) : [];
  return {
    columns: input.table.columns,
    rows: mentionedRows.length > 0 ? mentionedRows : input.table.rows,
  };
}

/**
 * A request that changes selection or computation needs a fresh data step
 * before export. Presentation-only follow-ups can safely reuse the last answer.
 */
export function dataExportNeedsFreshData(text: string): boolean {
  if (!requestedDataExportFormat(text)) return false;
  const normalized = text.normalize('NFKC').toLocaleLowerCase();
  if (/\b(?:last|previous|above|this|that)\s+(?:answer|response)\s+only\b/.test(normalized)) {
    return false;
  }
  return (
    /\b(?:filter|where|match(?:es|ed|ing)?|find|search|select|sort|group|join|calculate|compute|compare|recalculate|redo)\b/.test(
      normalized,
    ) ||
    /\b(?:first|last|top|bottom)\s+\d+\b/.test(normalized) ||
    /\b\d+\s+(?:matches|rows|records|results|people|items)\b/.test(normalized) ||
    /\b(?:only|except|excluding|including)\s+(?:rows|records|results|people|items|those)\b/.test(
      normalized,
    )
  );
}

/** Whether a presentation-only export refers to rendered prose/list rather than table rows. */
export function dataExportUsesAnswerText(text: string): boolean {
  const normalized = text.normalize('NFKC').toLocaleLowerCase();
  if (/\b(?:answer|response|list)\b/.test(normalized)) return true;
  if (/\b(?:data|dataset|table|rows|records|results)\b/.test(normalized)) return false;
  return true;
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
