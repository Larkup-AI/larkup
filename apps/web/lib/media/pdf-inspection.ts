import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getData } from 'pdf-parse/worker';
import { getLarkupDataDir } from '@larkup/core/project-store';

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
      // PDF.js loads its compatible @napi-rs/canvas version in Node. Setting
      // globals from the app's separate canvas dependency creates incompatible
      // Path2D instances, which breaks page rendering for text-heavy PDFs.
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
  const filePath = path.join(getLarkupDataDir(), 'uploads', fileName);
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size > MAX_SOURCE_BYTES) {
    throw new Error('The PDF is unavailable or too large for bounded local inspection.');
  }
  return fs.readFile(filePath);
}

const LOW_SIGNAL_QUERY_TERMS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'do',
  'for',
  'from',
  'give',
  'how',
  'i',
  'in',
  'is',
  'it',
  'me',
  'of',
  'on',
  'or',
  'please',
  'show',
  'state',
  'the',
  'to',
  'what',
  'when',
  'where',
  'which',
  'why',
  'with',
  'write',
]);

function queryTerms(question: string): string[] {
  return [
    ...new Set(
      (question.toLocaleLowerCase().match(/[\p{L}\p{N}_]{2,}/gu) ?? []).filter(
        (term) => !LOW_SIGNAL_QUERY_TERMS.has(term),
      ),
    ),
  ];
}

/** Numbered document references are stable, high-signal page anchors. */
function referencedDocumentLabels(question: string): string[] {
  const matches = [
    ...question
      .toLocaleLowerCase()
      .matchAll(
        /\b(fig(?:ure)?|diagram|chart|graph|illustration|table|eq(?:uation)?|section|chapter|appendix)\.?\s*(\d+(?:\.\d+)+)\b/gu,
      ),
  ];
  const labels = matches.flatMap((match) => {
    const kind = match[1];
    const number = match[2];
    if (!kind || !number) return [];
    // Authors commonly call the same visual object a figure, diagram, chart,
    // or illustration in questions while captions standardize on one of them.
    // The number remains the precise anchor; these are document-generic
    // caption aliases rather than a rule for any particular source.
    if (/^(?:fig(?:ure)?|diagram|chart|graph|illustration)$/u.test(kind)) {
      return [
        `figure ${number}`,
        `fig. ${number}`,
        `diagram ${number}`,
        `chart ${number}`,
        `graph ${number}`,
        `illustration ${number}`,
      ];
    }
    return [`${kind} ${number}`];
  });
  return [...new Set(labels)];
}

/**
 * A page can mention an object while the following page contains its caption
 * and visual. A caption/declaration is therefore a stronger match than prose
 * that only references the same numbered object.
 */
function declaredDocumentLabelScore(text: string, label: string): number {
  const declaration = new RegExp(`(?:^|\\n)\\s*${escapeRegExp(label)}\\s*[:.\\-]`, 'iu');
  return declaration.test(text) ? 100 : 0;
}

/** Rank pages only from their own extracted text; no document-specific assumptions. */
export function selectRelevantPdfPages(
  pages: Array<{ num: number; text: string }>,
  question: string,
  limit = MAX_PAGES,
): number[] {
  const terms = queryTerms(question);
  const labels = referencedDocumentLabels(question);
  if (pages.length === 0) return [];
  if (terms.length === 0) return pages.slice(0, limit).map((page) => page.num);
  const pageText = pages.map((page) => page.text.toLocaleLowerCase());
  const documentFrequency = new Map(
    terms.map((term) => [term, pageText.filter((text) => text.includes(term)).length]),
  );
  return pages
    .map((page, index) => {
      const text = pageText[index];
      const score = terms.reduce((total, term) => {
        const count = text.match(new RegExp(`\\b${escapeRegExp(term)}\\b`, 'gu'))?.length ?? 0;
        const frequency = documentFrequency.get(term) ?? pages.length;
        // A term found on only one or two pages is a stronger page anchor
        // than common prose found throughout the document or its contents.
        const specificity = Math.log((pages.length + 1) / (frequency + 1)) + 1;
        return total + count * specificity;
      }, 0);
      // A caption such as "Figure 5.1" is much more precise than its
      // individual number tokens, which can occur throughout a long paper.
      // Prefer the declaration/caption page over a preceding sentence that
      // merely says "see Figure 5.1".
      const labelScore = labels.reduce(
        (total, label) =>
          total + (text.includes(label) ? 20 : 0) + declaredDocumentLabelScore(text, label),
        0,
      );
      return { pageNumber: page.num, score: score + labelScore };
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

/** Preserve the ranked page order when a full extraction supplied the source text. */
export function selectInspectedPdfPages<T extends { num: number }>(
  pages: T[],
  selected: number[],
): T[] {
  const byNumber = new Map(pages.map((page) => [page.num, page]));
  return selected.flatMap((pageNumber) => {
    const page = byNumber.get(pageNumber);
    return page ? [page] : [];
  });
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
    // When we read the full PDF to rank its pages, return the selected page
    // objects rather than accidentally taking the first three pages from that
    // full extraction. This keeps the ranking decision and the model evidence
    // on the same source pages.
    const textPages = allText
      ? selectInspectedPdfPages(allText.pages, selectedPages)
      : textResult.pages;
    let tablePages: Array<{ pageNumber?: number; tables?: unknown[] }> = [];
    try {
      const tables = await parser.getTable({ partial: selectedPages });
      tablePages = (tables.pages ?? []) as Array<{ pageNumber?: number; tables?: unknown[] }>;
    } catch {
      // Table detection is optional; text and visual rendering remain useful.
    }
    return {
      totalPages: info.total,
      pages: textPages.slice(0, MAX_PAGES).map((page) => ({
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
