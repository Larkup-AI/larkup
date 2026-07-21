import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ slug: string[] }> }) {
  try {
    const resolvedParams = await params;
    const slug = resolvedParams.slug;
    if (!slug || slug.length === 0) {
      return new NextResponse('File not found', { status: 404 });
    }

    const filename = slug.join('/');
    // Prevent directory traversal
    if (filename.includes('..')) {
      return new NextResponse('Forbidden', { status: 403 });
    }

    const uploadsDir = path.join(process.cwd(), '../../.larkup/uploads');
    const filePath = path.join(uploadsDir, filename);

    if (!fs.existsSync(filePath)) {
      return new NextResponse('File not found', { status: 404 });
    }

    const stat = fs.statSync(filePath);
    const fileStream = fs.createReadStream(filePath) as any;

    // Determine content type based on extension
    const ext = path.extname(filename).toLowerCase();
    let contentType = 'application/octet-stream';

    switch (ext) {
      case '.png':
        contentType = 'image/png';
        break;
      case '.jpg':
      case '.jpeg':
        contentType = 'image/jpeg';
        break;
      case '.gif':
        contentType = 'image/gif';
        break;
      case '.webp':
        contentType = 'image/webp';
        break;
      case '.svg':
        contentType = 'image/svg+xml';
        break;
      case '.pdf':
        contentType = 'application/pdf';
        break;
      case '.mp4':
        contentType = 'video/mp4';
        break;
      case '.webm':
        contentType = 'video/webm';
        break;
      case '.mp3':
        contentType = 'audio/mpeg';
        break;
      case '.wav':
        contentType = 'audio/wav';
        break;
      case '.csv':
        contentType = 'text/csv';
        break;
      case '.txt':
        contentType = 'text/plain';
        break;
      case '.json':
        contentType = 'application/json';
        break;
    }

    const headers = new Headers();
    headers.set('Content-Type', contentType);
    headers.set('Content-Length', stat.size.toString());
    // Add cache control for better performance (cache for 1 hour)
    headers.set('Cache-Control', 'public, max-age=3600');

    return new NextResponse(fileStream, { headers });
  } catch (error) {
    console.error('Error serving file:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
