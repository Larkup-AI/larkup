import { mediaStats, readMediaAssets, recoverStaleMediaAssets } from '@larkup/core/media-store';
import { createStorageProvider } from '@larkup/marketplace/storage';
import type { MediaType } from '@larkup/core/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const encoder = new TextEncoder();

async function snapshot(typeFilter: MediaType | null) {
  const [assets, stats] = await Promise.all([readMediaAssets(), mediaStats()]);
  const filtered = typeFilter ? assets.filter((asset) => asset.type === typeFilter) : assets;
  filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const storage = createStorageProvider();
  const storageStats = await storage.stats();
  return {
    assets: filtered,
    stats,
    storage: { usedBytes: storageStats.usedBytes, fileCount: storageStats.fileCount },
  };
}

/**
 * Streams persisted media state changes to the open Media tab. This replaces
 * frequent client-side list requests while keeping the progress UI truthful:
 * a new event is sent only after the background worker saves a change.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const type = url.searchParams.get('type');
  const typeFilter: MediaType | null =
    type === 'image' || type === 'video' || type === 'audio' ? type : null;

  await recoverStaleMediaAssets();

  let interval: ReturnType<typeof setInterval> | undefined;
  let keepAlive: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let lastPayload = '';
      let checking = false;
      const publish = async () => {
        if (checking) return;
        checking = true;
        try {
          const payload = JSON.stringify(await snapshot(typeFilter));
          if (payload !== lastPayload) {
            lastPayload = payload;
            controller.enqueue(encoder.encode(`event: media-update\ndata: ${payload}\n\n`));
          }
        } catch {
          // Keep the connection open; the next change check can recover.
        } finally {
          checking = false;
        }
      };

      await publish();
      interval = setInterval(() => void publish(), 1_000);
      keepAlive = setInterval(() => controller.enqueue(encoder.encode(': keep-alive\n\n')), 15_000);
    },
    cancel() {
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
