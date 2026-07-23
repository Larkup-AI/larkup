import { NextResponse } from 'next/server';
import { restoreSession, parseDocument } from '@larkup/tool-doc-editor';
import type { EditorSession } from '@larkup/tool-doc-editor';

export async function POST(req: Request) {
  try {
    const { sessionId, fileBase64, parsedDocument, fileName, mimeType, activeFileType } =
      await req.json();

    if (!sessionId || !fileBase64) {
      return NextResponse.json({ error: 'Missing sessionId or fileBase64' }, { status: 400 });
    }

    const buffer = Buffer.from(fileBase64, 'base64');

    // Re-parse the actual file to get proper fields and pages.
    // This is critical: if we don't have a parsedDocument with fields,
    // any subsequent fill attempts will fail because field ID resolution
    // relies on session.parsed.fields being populated.
    let parsed;
    if (parsedDocument && parsedDocument.fields && parsedDocument.fields.length > 0) {
      parsed = parsedDocument;
    } else {
      try {
        const resolvedMime = mimeType || 'application/pdf';
        const resolvedName = fileName || 'Document';
        parsed = await parseDocument(buffer, resolvedName, resolvedMime);
        parsed.sessionId = sessionId;
      } catch (parseErr: any) {
        console.warn('[doc-editor/restore] Re-parse failed, using empty parsed:', parseErr.message);
        parsed = {
          sessionId,
          fileName: fileName || 'Document',
          type: activeFileType || 'pdf',
          mimeType: mimeType || 'application/pdf',
          fileSize: buffer.length,
          pages: [],
          fields: [],
          rawText: '',
          metadata: {},
          totalPages: 1,
        };
      }
    }

    const session: EditorSession = {
      id: sessionId,
      fileName: fileName || parsed.fileName || 'Document',
      type: activeFileType || parsed.type || 'pdf',
      mimeType: mimeType || parsed.mimeType || 'application/pdf',
      originalFileBase64: fileBase64,
      currentFileBase64: fileBase64,
      parsed: parsed,
      edits: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    restoreSession(session);
    console.log(
      `[doc-editor/restore] Session ${sessionId} restored with ${
        parsed.fields?.length ?? 0
      } fields`,
    );

    return NextResponse.json({ success: true, message: 'Session restored in backend' });
  } catch (error: any) {
    console.error('Error restoring session:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to restore session' },
      { status: 500 },
    );
  }
}
