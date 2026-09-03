import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getData } from 'pdf-parse/worker';

const MAX_SOURCE_BYTES = 100 * 1024 * 1024;
const MAX_PAGES = 3;
const MAX_PAGE_TEXT = 4_000;

export type PdfSource = { id: string; title: string; url?: string };

export type PdfPageInspection = {
  pageNumber: number;
  text: string;
  tables: unknown[];
  previewUrl?: string;
};

let parserPromise: Promise<(typeof import('pdf-parse'))['PDFParse']> | undefined;

async function getPdfParser() {
  if (!parserPromise) {
    parserPromise = (async () => {
      const canvas = await import('@napi-rs/canvas');
      Object.assign(globalThis, {
        DOMMatrix: canvas.DOMMatrix,
        ImageData: canvas.ImageData,
        Path2D: canvas.Path2D,
      });
      const { PDFParse } = await import('pdf-parse');
      PDFParse.setWorker(getData());
      return PDFParse;
    })();
  }
  return parserPromise;
}

function uploadFileName(url: string | undefined): string {
  const match = url?.match(/^\/api\/uploads\/([^/?#]+)$/);
  if (!match) throw new Error('The original PDF file is not available for local inspection.');
  const fileName = decodeURIComponent(match[1]);
  if (!fileName || fileName !== path.basename(fileName) || fileName.includes('..')) {
    throw new Error('The PDF source path is invalid.');
  }
  return fileName;
}

export async function readStoredPdfBytes(source: PdfSource): Promise<Buffer> {
  const fileName = uploadFileName(source.url);
  const filePath = path.join(process.cwd(), '.larkup', 'uploads', fileName);
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size > MAX_SOURCE_BYTES) {
    throw new Error('The PDF is unavailable or too large for bounded local inspection.');
  }
  return fs.readFile(filePath);
}

function queryTerms(question: string): string[] {
  return [...new Set(question.toLocaleLowerCase().match(/[\p{L}\p{N}_]{2,}/gu) ?? [])];
}

/** Rank pages only from their own extracted text; no document-specific assumptions. */
export function selectRelevantPdfPages(
  pages: Array<{ num: number; text: string }>,
  question: string,
  limit = MAX_PAGES,
): number[] {
  const terms = queryTerms(question);
  if (pages.length === 0) return [];
  if (terms.length === 0) return pages.slice(0, limit).map((page) => page.num);
  return pages
    .map((page) => {
      const text = page.text.toLocaleLowerCase();
      const score = terms.reduce(
        (total, term) =>
          total + (text.match(new RegExp(`\\b${escapeRegExp(term)}\\b`, 'gu'))?.length ?? 0),
        0,
      );
      return { pageNumber: page.num, score };
    })
    .sort((left, right) => right.score - left.score || left.pageNumber - right.pageNumber)
    .slice(0, limit)
    .map((page) => page.pageNumber);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function requestedPages(pages: number[] | undefined, total: number): number[] {
  return [...new Set(pages ?? [])]
    .filter((page) => Number.isInteger(page) && page >= 1 && page <= total)
    .slice(0, MAX_PAGES);
}

export async function inspectStoredPdf(
  source: PdfSource,
  question: string,
  pageNumbers?: number[],
  previewUrlForPage?: (pageNumber: number) => string,
): Promise<{ totalPages: number; pages: PdfPageInspection[] }> {
  const PDFParse = await getPdfParser();
  const parser = new PDFParse({ data: new Uint8Array(await readStoredPdfBytes(source)) });
  try {
    const info = await parser.getInfo();
    const explicitPages = requestedPages(pageNumbers, info.total);
    const allText = explicitPages.length ? undefined : await parser.getText();
    const selectedPages =
      explicitPages.length > 0
        ? explicitPages
        : selectRelevantPdfPages(allText?.pages ?? [], question, MAX_PAGES);
    const textResult = allText ?? (await parser.getText({ partial: selectedPages }));
    let tablePages: Array<{ pageNumber?: number; tables?: unknown[] }> = [];
    try {
      const tables = await parser.getTable({ partial: selectedPages });
      tablePages = (tables.pages ?? []) as Array<{ pageNumber?: number; tables?: unknown[] }>;
    } catch {
      // Table detection is optional; text and visual rendering remain useful.
    }
    return {
      totalPages: info.total,
      pages: textResult.pages.slice(0, MAX_PAGES).map((page) => ({
        pageNumber: page.num,
        text: page.text.slice(0, MAX_PAGE_TEXT),
        tables:
          tablePages.find((candidate) => candidate.pageNumber === page.num)?.tables?.slice(0, 4) ??
          [],
        previewUrl: previewUrlForPage?.(page.num),
      })),
    };
  } finally {
    await parser.destroy();
  }
}

export async function renderStoredPdfPage(
  source: PdfSource,
  pageNumber: number,
  width = 1_600,
): Promise<{ data: Buffer; contentType: string }> {
  const PDFParse = await getPdfParser();
  const parser = new PDFParse({ data: new Uint8Array(await readStoredPdfBytes(source)) });
  try {
    const info = await parser.getInfo();
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > info.total) {
      throw new Error(`Page ${pageNumber} is outside this PDF.`);
    }
    const screenshots = await parser.getScreenshot({
      partial: [pageNumber],
      desiredWidth: Math.min(Math.max(width, 480), 2_000),
      imageBuffer: true,
      imageDataUrl: false,
    });
    const screenshot = screenshots.pages[0];
    if (!screenshot?.data) throw new Error('Could not render the requested PDF page.');
    return { data: Buffer.from(screenshot.data), contentType: 'image/png' };
  } finally {
    await parser.destroy();
  }
}
