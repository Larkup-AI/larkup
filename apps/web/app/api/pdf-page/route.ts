import { NextResponse } from 'next/server';
import { readDocuments } from '@larkup/core/documents-store';
import { runWithProject } from '@larkup/core/project-store';
import { renderStoredPdfPage } from '@/lib/media/pdf-inspection';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const documentId = url.searchParams.get('documentId');
  const pageNumber = Number(url.searchParams.get('page'));
  const projectId = url.searchParams.get('projectId');
  if (!documentId || !Number.isInteger(pageNumber) || pageNumber < 1) {
    return NextResponse.json(
      { error: 'documentId and a positive page are required.' },
      { status: 400 },
    );
  }

  try {
    const findDocument = async () =>
      (await readDocuments()).find((document) => document.id === documentId);
    const document = projectId
      ? await runWithProject(projectId, findDocument)
      : await findDocument();
    if (!document) return NextResponse.json({ error: 'PDF document not found.' }, { status: 404 });
    const rendered = await renderStoredPdfPage(document, pageNumber);
    return new NextResponse(new Uint8Array(rendered.data), {
      headers: {
        'Content-Type': rendered.contentType,
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message ?? 'Could not render the PDF page.' },
      { status: 422 },
    );
  }
}
