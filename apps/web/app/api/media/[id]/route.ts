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

    return new NextResponse(data, {
      headers: {
        'Content-Type': mimeType,
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
