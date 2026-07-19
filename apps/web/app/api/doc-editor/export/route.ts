import { NextResponse } from 'next/server';
import { exportDocument } from '@larkup/tool-doc-editor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/doc-editor/export?sessionId=xxx
 *
 * Downloads the current (possibly modified) document as a binary file.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get('sessionId');

  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
  }

  const result = exportDocument(sessionId);
  if (!result) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  return new NextResponse(result.buffer, {
    status: 200,
    headers: {
      'Content-Type': result.mimeType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(result.fileName)}"`,
      'Content-Length': String(result.buffer.length),
    },
  });
}
