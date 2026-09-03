import { readMediaAssets } from '@larkup/core/media-store';
import { createStorageProvider } from '@larkup/marketplace/storage';
import type { MediaType } from '@larkup/core/types';
import { runWithProject } from '@larkup/core/project-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const encoder = new TextEncoder();

async function snapshot(
  typeFilter: MediaType | null,
  storageSnapshot: { usedBytes: number; fileCount: number },
) {
  const assets = await readMediaAssets();
  const filtered = typeFilter ? assets.filter((asset) => asset.type === typeFilter) : assets;
  filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const stats = {
    total: assets.length,
    byType: { image: 0, video: 0, audio: 0 },
    byStatus: { pending: 0, processing: 0, completed: 0, failed: 0 },
    totalBytes: 0,
  };
  for (const asset of assets) {
    stats.byType[asset.type]++;
    stats.byStatus[asset.processingStatus]++;
    stats.totalBytes += asset.fileSize;
  }
  return {
    assets: filtered,
    stats,
    storage: storageSnapshot,
  };
}

/**
 * Streams persisted media state changes to the open Media tab. This replaces
 * frequent client-side list requests while keeping the progress UI truthful:
 * a new event is sent only after the background worker saves a change.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const requestedType = url.searchParams.get('type');
  const serverId = url.searchParams.get('serverId');
  const typeFilter: MediaType | null =
    requestedType === 'image' || requestedType === 'video' || requestedType === 'audio'
      ? requestedType
      : null;
  const scoped = <T>(fn: () => T): T => (serverId ? runWithProject(serverId, fn) : fn());

  let interval: ReturnType<typeof setInterval> | undefined;
  let keepAlive: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let lastPayload = '';
      let checking = false;
      let storageSnapshot = { usedBytes: 0, fileCount: 0 };
      let storageCheckedAt = 0;

      const safeEnqueue = (data: Uint8Array) => {
        if (closed) return;
        try {
          controller.enqueue(data);
        } catch {
          // Controller already closed — client disconnected.
          closed = true;
          if (interval) clearInterval(interval);
          if (keepAlive) clearInterval(keepAlive);
        }
      };

      const publish = async () => {
        if (checking || closed) return;
        checking = true;
        try {
          if (Date.now() - storageCheckedAt > 30_000) {
            try {
              const storageStats = await scoped(() => createStorageProvider().stats());
              storageSnapshot = {
                usedBytes: storageStats.usedBytes,
                fileCount: storageStats.fileCount,
              };
            } catch {
              // Progress remains streamable even if a remote storage provider
              // cannot calculate aggregate usage at this moment.
            }
            storageCheckedAt = Date.now();
          }
          const nextSnapshot = await scoped(() => snapshot(typeFilter, storageSnapshot));
          const payload = JSON.stringify(nextSnapshot);
          if (payload !== lastPayload) {
            lastPayload = payload;
            const revision = Math.max(
              0,
              ...nextSnapshot.assets.map((asset) => asset.processingRevision ?? 0),
            );
            safeEnqueue(
              encoder.encode(`id: ${revision}\nevent: media-update\ndata: ${payload}\n\n`),
            );
          }
        } catch {
          // Keep the connection open; the next change check can recover.
        } finally {
          checking = false;
        }
      };

      await publish();
      interval = setInterval(() => void publish(), 1_000);
      keepAlive = setInterval(() => safeEnqueue(encoder.encode(': keep-alive\n\n')), 15_000);
    },
    cancel() {
      closed = true;
      if (interval) clearInterval(interval);
      if (keepAlive) clearInterval(keepAlive);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
