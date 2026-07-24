import { NextResponse } from 'next/server';
import JSZip from 'jszip';
import { readConfig } from '@larkup/core/config-store';
import { generateServer } from '@larkup/core/generator/generate-server';
import { getActiveServer } from '@larkup/core/workspace';

export const dynamic = 'force-dynamic';

/**
 * Phase 4 — server generation.
 *
 *   GET /api/server/generate            -> JSON manifest (files + deps + env)
 *   GET /api/server/generate?download=1 -> a .zip of the generated server
 *
 * The generator reads the saved RagConfig and emits a standalone, dependency-
 * minimal RAG server tailored to the selected vector store.
 */
export async function GET(req: Request) {
  const config = await readConfig();
  const server = generateServer(config);
  const activeServer = await getActiveServer();
  const serverId = activeServer?.id ?? 'default';

  const url = new URL(req.url);
  if (url.searchParams.get('download') === '1') {
    const zip = new JSZip();
    const root = server.projectName || 'rag-server';
    for (const file of server.files) {
      if (file.encoding === 'base64') {
        zip.file(`${root}/${file.path}`, file.contents, { base64: true });
      } else {
        zip.file(`${root}/${file.path}`, file.contents);
      }
    }
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${root}.zip"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  return NextResponse.json({ config, server, serverId });
}
