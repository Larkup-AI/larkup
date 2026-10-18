import mammoth from 'mammoth';
import { getData } from 'pdf-parse/worker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Use pdf-parse's packaged worker payload. Unlike a filesystem path, it is
// preserved in Next's standalone output and always matches the parser version.
let pdfParserPromise: Promise<(typeof import('pdf-parse'))['PDFParse']> | undefined;

async function getPdfParser() {
  if (!pdfParserPromise) {
    pdfParserPromise = (async () => {
      // Let PDF.js load its own compatible Node canvas implementation. Mixing
      // it with the app-level canvas package creates incompatible Path2D
      // instances and prevents the same PDF from being rendered later.
      const { PDFParse } = await import('pdf-parse');
      PDFParse.setWorker(getData());
      return PDFParse;
    })();
  }
  return pdfParserPromise;
}

/** pdf-parse adds page counters even when a scanned PDF has no text layer. */
export function hasReadablePdfText(text: string): boolean {
  return text.replace(/^\s*--\s*\d+\s+of\s+\d+\s*--\s*$/gim, '').replace(/[\s\f]+/g, '').length > 0;
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return Response.json({ error: 'No file provided' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    let text = '';

    if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
      // pdf-parse accepts typed-array input consistently across Next's Node
      // runtime and standalone builds. Passing Buffer directly can fail for
      // otherwise-valid PDFs after bundling.
      const PDFParse = await getPdfParser();
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      try {
        text = (await parser.getText()).text;
      } finally {
        await parser.destroy();
      }
    } else if (
      file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      file.name.endsWith('.docx')
    ) {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
    } else {
      return Response.json({ error: 'Unsupported file type' }, { status: 400 });
    }

    const hasReadableText =
      file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
        ? hasReadablePdfText(text)
        : Boolean(text.trim());

    // Image-only PDFs are still valid sources. The shared upload UI renders
    // their pages and sends them through the configured vision model.
    if (
      !hasReadableText &&
      (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))
    ) {
      return Response.json({ text: '', hasReadableText: false });
    }

    if (!hasReadableText) {
      return Response.json({ error: 'No readable text was found in this file.' }, { status: 422 });
    }

    return Response.json({ text, hasReadableText: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to parse file.';
    return Response.json({ error: message }, { status: 500 });
  }
}
