import { promises as fs } from 'node:fs';
import path from 'node:path';
import mammoth from 'mammoth';
import { getData } from 'pdf-parse/worker';

export interface LocalTextFile {
  path: string;
  title: string;
  content: string;
}

const TEXT_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.mdx',
  '.json',
  '.jsonl',
  '.csv',
  '.tsv',
  '.html',
  '.htm',
  '.xml',
  '.yaml',
  '.yml',
  '.log',
  '.rst',
  '.tex',
  '.js',
  '.ts',
  '.tsx',
  '.jsx',
  '.py',
  '.java',
  '.go',
  '.rs',
  '.rb',
  '.php',
  '.sql',
  '.sh',
  '.css',
]);

const PDF_EXTENSIONS = new Set(['.pdf']);
const WORD_EXTENSIONS = new Set(['.docx']);

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.mkv']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.wav', '.ogg', '.flac']);
const MEDIA_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.mp4',
  '.webm',
  '.mov',
  '.mkv',
  '.mp3',
  '.m4a',
  '.wav',
  '.ogg',
  '.flac',
]);

const SKIPPED_DIRECTORIES = new Set(['.git', '.larkup', 'node_modules', 'dist', 'build']);

export type LocalFileKind = 'text' | 'pdf' | 'json' | 'media' | 'image' | 'audio' | 'video';

export interface LocalFileFilter {
  kinds?: LocalFileKind[];
  extensions?: string[];
}

let pdfParserPromise: Promise<(typeof import('pdf-parse'))['PDFParse']> | undefined;

function extensionOf(filePath: string): string {
  return path.extname(filePath).toLowerCase();
}

function normalizedExtension(extension: string): string {
  const value = extension.trim().toLowerCase();
  return value ? (value.startsWith('.') ? value : `.${value}`) : '';
}

async function getPdfParser() {
  if (!pdfParserPromise) {
    pdfParserPromise = (async () => {
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
  return pdfParserPromise;
}

export function isMediaPath(filePath: string) {
  return MEDIA_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function filterLocalFiles(files: string[], filter: LocalFileFilter = {}): string[] {
  const requestedExtensions = new Set(
    (filter.extensions ?? []).map(normalizedExtension).filter(Boolean),
  );
  const requestedKinds = new Set(filter.kinds ?? []);
  if (requestedExtensions.size === 0 && requestedKinds.size === 0) return files;

  return files.filter((filePath) => {
    const extension = extensionOf(filePath);
    if (requestedExtensions.has(extension)) return true;
    if (requestedKinds.has('media') && MEDIA_EXTENSIONS.has(extension)) return true;
    if (requestedKinds.has('image') && IMAGE_EXTENSIONS.has(extension)) return true;
    if (requestedKinds.has('audio') && AUDIO_EXTENSIONS.has(extension)) return true;
    if (requestedKinds.has('video') && VIDEO_EXTENSIONS.has(extension)) return true;
    if (requestedKinds.has('pdf') && PDF_EXTENSIONS.has(extension)) return true;
    if (requestedKinds.has('json') && (extension === '.json' || extension === '.jsonl'))
      return true;
    return requestedKinds.has('text') && TEXT_EXTENSIONS.has(extension);
  });
}

export async function collectFiles(inputs: string[]): Promise<string[]> {
  const files: string[] = [];

  for (const input of inputs) {
    const absolute = path.resolve(input);
    const stat = await fs.stat(absolute).catch(() => undefined);
    if (!stat) throw new Error(`Path does not exist: ${input}`);

    if (stat.isFile()) {
      files.push(absolute);
      continue;
    }

    if (!stat.isDirectory()) continue;
    await walk(absolute, files);
  }

  return files.sort();
}

async function walk(directory: string, files: string[]): Promise<void> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name)) {
      await walk(path.join(directory, entry.name), files);
    } else if (entry.isFile()) {
      files.push(path.join(directory, entry.name));
    }
  }
}

export async function readTextFiles(files: string[]): Promise<LocalTextFile[]> {
  const documents: LocalTextFile[] = [];
  for (const filePath of files) {
    const extension = extensionOf(filePath);
    let content: string;
    if (PDF_EXTENSIONS.has(extension)) {
      const PDFParse = await getPdfParser();
      const parser = new PDFParse({ data: new Uint8Array(await fs.readFile(filePath)) });
      try {
        content = (await parser.getText()).text;
      } finally {
        await parser.destroy();
      }
    } else if (WORD_EXTENSIONS.has(extension)) {
      content = (await mammoth.extractRawText({ buffer: await fs.readFile(filePath) })).value;
    } else {
      if (!TEXT_EXTENSIONS.has(extension)) continue;
      content = await fs.readFile(filePath, 'utf8');
    }
    if (!content.trim() || content.includes('\0')) continue;
    documents.push({
      path: filePath,
      title: path.basename(filePath),
      content,
    });
  }
  return documents;
}
