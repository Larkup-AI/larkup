import { NextRequest, NextResponse } from 'next/server';
import { applySignature } from '@larkup/tool-doc-editor';
import { z } from 'zod';

const requestSchema = z.object({
  sessionId: z.string(),
  signatureData: z.object({
    mode: z.enum(['type', 'draw', 'upload']),
    imagePayload: z.string().optional(),
    text: z.string().optional(),
    font: z.string().optional(),
    color: z.string().optional(),
    date: z.string().optional(),
    extraText: z.string().optional(),
    pageIndex: z.number(),
    x: z.number().optional(),
    y: z.number().optional(),
    scale: z.number().optional(),
    base64Override: z.string().optional(),
    detectedContext: z.string().optional(),
    placementNote: z.string().optional(),
  }),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const result = requestSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: 'Invalid request data', details: result.error.issues },
        { status: 400 },
      );
    }

    const { sessionId, signatureData } = result.data;
    const editResult = await applySignature(sessionId, signatureData as any);

    if (!editResult.success) {
      return NextResponse.json({ error: editResult.error }, { status: 500 });
    }

    // Since EditResult no longer returns `document` but `parsed` and `fileBase64`, we return those.
    return NextResponse.json({
      document: {
        parsed: (editResult as any).parsed,
        fileBase64: (editResult as any).fileBase64,
        updatedFields: (editResult as any).updatedFields,
      },
    });
  } catch (err: any) {
    console.error('Sign doc error:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
