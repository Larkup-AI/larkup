import { NextResponse } from 'next/server';
import { getMediaAsset, updateMediaAsset } from '@larkup/core/media-store';
import { createStorageProvider } from '@larkup/marketplace/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET → serve a media file or its thumbnail. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(_req.url);
  const wantThumb = url.searchParams.get('thumb') === 'true';

  const asset = await getMediaAsset(id);
  if (!asset) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const storage = createStorageProvider();
  const uri = wantThumb && asset.thumbnailUri ? asset.thumbnailUri : asset.storageUri;

  try {
    const data = await storage.retrieve(uri);
    const mimeType = wantThumb ? 'image/webp' : asset.mimeType;
    const range = !wantThumb ? _req.headers.get('range') : null;

    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) {
        return new NextResponse(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${data.length}` },
        });
      }
      const suffixLength = !match[1] && match[2] ? Number(match[2]) : null;
      const start =
        suffixLength !== null
          ? Math.max(0, data.length - suffixLength)
          : match[1]
          ? Number(match[1])
          : 0;
      const end =
        suffixLength !== null
          ? data.length - 1
          : match[2]
          ? Math.min(Number(match[2]), data.length - 1)
          : data.length - 1;
      if (start > end || start >= data.length) {
        return new NextResponse(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${data.length}` },
        });
      }
      const chunk = data.subarray(start, end + 1);
      return new NextResponse(chunk, {
        status: 206,
        headers: {
          'Content-Type': mimeType,
          'Accept-Ranges': 'bytes',
          'Content-Range': `bytes ${start}-${end}/${data.length}`,
          'Content-Length': String(chunk.length),
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    }

    return new NextResponse(data, {
      headers: {
        'Content-Type': mimeType,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Length': String(data.length),
      },
    });
  } catch {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }
}

/** PATCH → update media asset metadata. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await req.json();
    const updated = await updateMediaAsset(id, body);
    if (!updated) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ asset: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Update failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
