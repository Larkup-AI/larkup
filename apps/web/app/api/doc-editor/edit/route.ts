import { NextResponse } from 'next/server';
import { applyFieldEdits, applyContentEdits, getSession } from '@larkup/tool-doc-editor';
import type { FieldEdit, ContentEdit } from '@larkup/tool-doc-editor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/doc-editor/edit
 *
 * Applies edits (field fills or content changes) to a document session.
 * Returns the updated parsed document and a flag for live preview refresh.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { sessionId, fieldEdits, contentEdits } = body as {
      sessionId: string;
      fieldEdits?: FieldEdit[];
      contentEdits?: ContentEdit[];
    };

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
    }

    const session = getSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // Apply field edits if provided
    if (fieldEdits && fieldEdits.length > 0) {
      const result = await applyFieldEdits(sessionId, fieldEdits);

      if (!result.success) {
        return NextResponse.json(
          { error: result.error, fields: session.parsed.fields },
          { status: 500 },
        );
      }

      return NextResponse.json({
        success: true,
        updatedFields: result.updatedFields,
        fields: result.parsed.fields,
        pages: result.parsed.pages.map((p) => ({
          index: p.index,
          text: p.text.slice(0, 2000),
          html: p.html,
          fields: p.fields,
          dimensions: p.dimensions,
        })),
        totalPages: result.parsed.totalPages,
        // Include base64 for live preview
        fileBase64: result.fileBase64,
      });
    }

    // Apply content edits if provided
    if (contentEdits && contentEdits.length > 0) {
      const result = await applyContentEdits(sessionId, contentEdits);

      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        updatedFields: result.updatedFields,
        pages: result.parsed.pages.map((p) => ({
          index: p.index,
          text: p.text.slice(0, 2000),
          html: p.html,
          fields: p.fields,
          dimensions: p.dimensions,
        })),
        totalPages: result.parsed.totalPages,
        fileBase64: result.fileBase64,
      });
    }

    return NextResponse.json({ error: 'No edits provided' }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Edit failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
