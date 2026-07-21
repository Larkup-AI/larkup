import { NextResponse } from 'next/server';
import {
  addDocument,
  clearDocuments,
  corpusStats,
  deleteDocument,
  deleteDocuments,
  readDocuments,
  updateDocument,
} from '@larkup/core/documents-store';
import { readConfig } from '@larkup/core/config-store';
import { readRun, patchRun } from '@larkup/core/index-store';
import { createAdapter } from '@larkup/vector-stores/factory';
import type { DocumentSource } from '@larkup/core/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET → the full corpus plus summary stats. */
export async function GET() {
  const [documents, stats] = await Promise.all([readDocuments(), corpusStats()]);

  // Sort documents by createdAt descending (newest first)
  const sortedDocuments = documents.sort((a, b) => {
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return NextResponse.json({ documents: sortedDocuments, stats });
}

import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';

/**
 * POST → ingest pasted text or an uploaded file's contents.
 * Body: { title, content, source: "paste" | "upload", url? }
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      title?: string;
      content?: string;
      source?: DocumentSource;
      url?: string;
      metadata?: Record<string, any>;
    };
    if (!body.content || !body.content.trim()) {
      return NextResponse.json({ error: 'Content is empty.' }, { status: 400 });
    }

    // Intercept imageBase64 and write it to disk
    if (body.metadata && body.metadata.isImage && body.metadata.imageBase64) {
      try {
        const base64Data = body.metadata.imageBase64.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        const filename = `${randomUUID()}.png`;
        const uploadsDir = path.join(process.cwd(), '../../.larkup/uploads');
        await fs.mkdir(uploadsDir, { recursive: true });
        await fs.writeFile(path.join(uploadsDir, filename), buffer);

        // Remove base64 string and save the URL instead
        delete body.metadata.imageBase64;
        body.metadata.imageUrl = `/api/uploads/${filename}`;

        // Use imageUrl as the url for the document
        body.url = body.metadata.imageUrl;
      } catch (err) {
        console.error('Failed to save extracted image to disk', err);
      }
    }

    const doc = await addDocument({
      title: body.title ?? 'Untitled',
      content: body.content,
      source: body.source === 'upload' ? 'upload' : 'paste',
      url: body.url,
      metadata: body.metadata,
    });
    return NextResponse.json({ document: doc }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to add document.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PATCH → edit a document in place.
 * Body: { id, title?, content?, url? }
 */
export async function PATCH(req: Request) {
  let body: {
    id?: string;
    title?: string;
    content?: string;
    url?: string;
    metadata?: Record<string, any>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (!body.id) {
    return NextResponse.json({ error: 'id is required.' }, { status: 400 });
  }
  if (body.content !== undefined && !body.content.trim()) {
    return NextResponse.json({ error: 'Content is empty.' }, { status: 400 });
  }
  const doc = await updateDocument(body.id, {
    title: body.title,
    content: body.content,
    url: body.url,
    metadata: body.metadata,
  });
  if (!doc) {
    return NextResponse.json({ error: 'Document not found.' }, { status: 404 });
  }
  return NextResponse.json({ document: doc });
}

/** DELETE ?id=<id> removes one doc; DELETE ?ids=1,2 removes many; DELETE with no id clears the corpus. */
export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  const ids = url.searchParams.get('ids');

  // Clean up associated media assets
  const docs = await readDocuments();
  let toDeleteDocs = [];
  if (id) {
    toDeleteDocs = docs.filter((d) => d.id === id);
  } else if (ids) {
    const idList = ids.split(',');
    toDeleteDocs = docs.filter((d) => idList.includes(d.id));
  } else {
    toDeleteDocs = docs;
  }

  for (const doc of toDeleteDocs) {
    if (doc.metadata?.mediaAssetId) {
      const { getMediaAsset, deleteMediaAsset } = await import('@larkup/core/media-store');
      const { createStorageProvider } = await import('@larkup/marketplace/storage');
      const asset = await getMediaAsset(doc.metadata.mediaAssetId);
      if (asset) {
        const storage = createStorageProvider();
        await storage.delete(asset.storageUri).catch(() => {});
        if (asset.thumbnailUri) await storage.delete(asset.thumbnailUri).catch(() => {});
        await deleteMediaAsset(doc.metadata.mediaAssetId);
      }
    }

    const cleanupUrls = [doc.url, doc.metadata?.imageUrl].filter(Boolean);
    for (const docUrl of cleanupUrls) {
      if (docUrl?.startsWith('/api/media/')) {
        const assetId = docUrl.split('/api/media/')[1]?.split('?')[0];
        if (assetId) {
          const { getMediaAsset, deleteMediaAsset } = await import('@larkup/core/media-store');
          const { createStorageProvider } = await import('@larkup/marketplace/storage');
          const asset = await getMediaAsset(assetId);
          if (asset) {
            const storage = createStorageProvider();
            await storage.delete(asset.storageUri).catch(() => {});
            if (asset.thumbnailUri) await storage.delete(asset.thumbnailUri).catch(() => {});
            await deleteMediaAsset(assetId);
          }
        }
      } else if (docUrl?.startsWith('/api/uploads/')) {
        const filename = docUrl.split('/api/uploads/')[1]?.split('?')[0];
        if (filename) {
          const uploadsDir = path.join(process.cwd(), '../../.larkup/uploads');
          await fs.unlink(path.join(uploadsDir, filename)).catch(() => {});
        }
      }
    }
  }

  let deletedIds: string[] = [];

  if (id) {
    await deleteDocument(id);
    deletedIds = [id];
  } else if (ids) {
    const idList = ids.split(',');
    await deleteDocuments(idList);
    deletedIds = idList;
  } else {
    await clearDocuments();

    try {
      const config = await readConfig();
      const adapter = await createAdapter(config);
      await adapter.init(0);
      await adapter.reset();
    } catch {}

    try {
      const run = await readRun();
      if (run) {
        await patchRun({
          status: 'failed',
          error: 'Corpus cleared — index invalidated.',
          finishedAt: new Date().toISOString(),
        });
      }
    } catch {
      // best-effort
    }
  }

  if (deletedIds.length > 0) {
    try {
      const config = await readConfig();
      const adapter = await createAdapter(config);
      await adapter.init(0);
      await adapter.deleteByDocumentIds(deletedIds);
    } catch (err) {
      console.error('Failed to delete vectors for specific documents:', err);
    }
  }
  return NextResponse.json({ ok: true });
}
