import { NextResponse } from 'next/server';
import mammoth from 'mammoth';
import { getData } from 'pdf-parse/worker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Use pdf-parse's packaged worker payload. Unlike a filesystem path, it is
// preserved in Next's standalone output and always matches the parser version.
let pdfParserPromise: Promise<typeof import('pdf-parse')['PDFParse']> | undefined;

async function getPdfParser() {
  if (!pdfParserPromise) {
    pdfParserPromise = (async () => {
      // pdfjs-dist needs these globals while its Node build is evaluated. The
      // static import used to run first in the standalone server, where the
      // transitive optional canvas package was not traced, causing every PDF
      // upload to fail with "DOMMatrix is not defined".
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

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
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
      return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 });
    }

    if (!text.trim()) {
      return NextResponse.json(
        { error: 'No readable text was found in this file.' },
        { status: 422 },
      );
    }

    return NextResponse.json({ text });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to parse file.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
