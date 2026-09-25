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
