import { NextResponse } from 'next/server';
import { createSession, enrichPDFWithText, getSession } from '@larkup/tool-doc-editor';
// @ts-expect-error — import from lib to avoid pdf-parse's test-file-loading bug
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/doc-editor/parse
 *
 * Accepts a file upload (FormData), parses it, creates an editor session,
 * and returns the parsed document structure.
 */
export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const session = await createSession(buffer, file.name, file.type);

    // For PDFs, enrich with full text extraction via pdf-parse
    // Skip heavy text extraction for long PDFs (e.g. > 5 pages) to just "view" them quickly
    if (session.type === 'pdf' && session.parsed.rawText === '') {
      if (session.parsed.totalPages <= 5) {
        try {
          const pdfData = await pdfParse(buffer);
          const enrichedParsed = enrichPDFWithText(session.parsed, pdfData.text);
          session.parsed = enrichedParsed;
        } catch {
          // pdf-parse failed — continue with whatever we have
        }
      } else {
        session.parsed.rawText = `[Long PDF - Text extraction skipped for performance. You can still view it.]`;
      }
    }

    // Return a lightweight response (no base64 file data)
    return NextResponse.json({
      sessionId: session.id,
      fileName: session.fileName,
      type: session.type,
      mimeType: session.mimeType,
      fileSize: session.parsed.fileSize,
      totalPages: session.parsed.totalPages,
      fields: session.parsed.fields,
      pages: session.parsed.pages.map((p) => ({
        index: p.index,
        text: p.text.slice(0, 2000), // Limit text for response size
        html: p.html,
        fields: p.fields,
        dimensions: p.dimensions,
      })),
      rawText: session.parsed.rawText.slice(0, 5000),
      metadata: session.parsed.metadata,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to parse file';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
