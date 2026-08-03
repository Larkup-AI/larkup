import { NextResponse } from 'next/server';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// pdf-parse's default Node worker path is lost when Next bundles a route.
// Resolve the matching worker from pdf-parse's own pdfjs-dist dependency so
// the API and worker versions stay in lockstep.
const appRequire = createRequire(`${process.cwd()}/package.json`);
const pdfParseRequire = createRequire(appRequire.resolve('pdf-parse'));
PDFParse.setWorker(
  pathToFileURL(pdfParseRequire.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href,
);

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
