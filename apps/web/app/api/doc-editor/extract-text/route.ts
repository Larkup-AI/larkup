import { NextResponse } from 'next/server';
import { parseDocument } from '@larkup/tool-doc-editor';

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const files = formData.getAll('files') as File[];

    if (!files || files.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 });
    }

    const results: { fileName: string; content: string; error?: string }[] = [];

    for (const file of files) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const parsed = await parseDocument(buffer, file.name, file.type);

        // Extract text content, truncated to avoid massive payloads
        const content = parsed.rawText || parsed.pages.map((p) => p.text).join('\n\n');
        results.push({
          fileName: file.name,
          content: content.substring(0, 15000), // Cap at 15K chars per file
        });
      } catch (err: any) {
        results.push({
          fileName: file.name,
          content: '',
          error: err.message || 'Failed to extract text',
        });
      }
    }

    return NextResponse.json({ results });
  } catch (err: any) {
    console.error('Extract text error:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
