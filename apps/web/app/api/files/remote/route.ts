import { NextResponse } from 'next/server';
import { downloadRemoteFile } from '@/lib/remote-files';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { url?: unknown };
    if (typeof body.url !== 'string' || !body.url.trim()) {
      return NextResponse.json({ error: 'Enter a file URL to continue.' }, { status: 400 });
    }

    const file = await downloadRemoteFile(body.url);
    const responseBody = file.bytes.buffer.slice(
      file.bytes.byteOffset,
      file.bytes.byteOffset + file.bytes.byteLength,
    ) as ArrayBuffer;
    return new NextResponse(responseBody, {
      headers: {
        'Content-Type': file.contentType,
        'Content-Length': String(file.bytes.byteLength),
        'Cache-Control': 'no-store',
        'X-Larkup-File-Name': encodeURIComponent(file.fileName),
        'X-Larkup-Source-Url': encodeURIComponent(file.sourceUrl),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not download the remote file.';
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
