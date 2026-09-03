import { randomUUID } from 'node:crypto';
import type { IndexRun, RagConfig } from '../types';
import { readDocuments, updateDocumentsStatus } from '../documents-store';
import { claimRun, patchRun as patchStoredRun } from '../index-store';
import { chunkCorpus } from './chunker';
import { embedTexts, expectedDimensions } from './embedder';
import { createAdapter } from '@larkup/vector-stores/factory';
import type { VectorRecord } from '@larkup/vector-stores/adapter';

/**
 * The indexing pipeline: corpus → chunks → embeddings → vector store.
 *
 * Runs in the background (fire-and-forget from the API route) and streams
 * progress to the file-backed run store so the UI can poll it. Embedding +
 * upsert happen in batches so memory stays flat and progress is granular even
 * for large corpora.
 */

const EMBED_BATCH = 64;
const MAX_RATE_LIMIT_RETRIES = 5;

/** Provider SDKs do not normalize quota failures consistently. Gemini can
 * return RESOURCE_EXHAUSTED / "Quota exceeded" after its internal retries
 * without exposing a numeric 429 status. */
export function isRateLimitError(error: unknown): boolean {
  const candidate = error as { status?: number; statusCode?: number; message?: unknown } | null;
  const message = String(candidate?.message ?? error ?? '').toLowerCase();
  return (
    candidate?.status === 429 ||
    candidate?.statusCode === 429 ||
    /\b429\b|rate[ -]?limit|too many requests|resource_exhausted|quota exceeded|quota.*exceed/.test(
      message,
    )
  );
}

/** Prefer the provider's explicit retry window and otherwise back off
 * conservatively. The cap prevents a malformed provider message from parking
 * an indexing worker indefinitely. */
export function rateLimitDelayMs(error: unknown, attempt: number): number {
  const message = String((error as { message?: unknown } | null)?.message ?? error ?? '');
  const retryMatch = message.match(
    /(?:retry(?:\s+after|\s+in)?|try again(?:\s+in)?)\s*(\d+(?:\.\d+)?)\s*(?:s|sec(?:ond)?s?)/i,
  );
  if (retryMatch) {
    return Math.min(120_000, Math.max(2_000, Math.ceil(Number(retryMatch[1]) * 1_000)));
  }
  return Math.min(60_000, 5_000 * 2 ** (attempt - 1));
}

/** Create the initial run record and persist it before work begins. */
export async function createRun(config: RagConfig): Promise<IndexRun> {
  const now = new Date().toISOString();
  const run: IndexRun = {
    id: randomUUID(),
    status: 'chunking',
    embeddingModelId: config.embeddingModelId,
    vectorStore: config.vectorStore,
    indexType: config.indexType,
    totalChunks: 0,
    processedChunks: 0,
    docCount: 0,
    dimensions: expectedDimensions(config),
    startedAt: now,
    updatedAt: now,
  };
  return claimRun(run);
}

/**
 * Execute the run. Designed to be called WITHOUT awaiting from the route so the
 * HTTP request returns immediately; all progress is observable via the store.
 */
export async function runIndexer(
  runId: string,
  config: RagConfig,
  previousRun: IndexRun | null = null,
): Promise<void> {
  const started = Date.now();
  const patchRun = async (patch: Partial<IndexRun>) => {
    const updated = await patchStoredRun(patch, runId, true);
    if (!updated) throw new Error('This index run no longer owns the active index lease.');
    return updated;
  };
  try {
    let docs = await readDocuments();

    if (previousRun) {
      // Status is the durable source of truth. This also makes a retry after a
      // partial failure resume only the documents that still need vectors.
      docs = docs.filter((document) => document.status !== 'indexed');
    }

    if (docs.length === 0) {
      if (previousRun) {
        await patchRun({
          status: 'completed',
          docCount: 0,
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - started,
        });
      } else {
        await patchRun({
          status: 'failed',
          error: 'The corpus is empty. Load documents before indexing.',
          finishedAt: new Date().toISOString(),
        });
      }
      return;
    }

    // 1) Chunk
    await patchRun({ status: 'chunking', docCount: docs.length });
    const chunks = chunkCorpus(docs, config.chunking);
    if (chunks.length === 0) {
      if (previousRun) {
        await patchRun({
          status: 'completed',
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - started,
        });
      } else {
        await patchRun({
          status: 'failed',
          error: 'No chunks were produced from the corpus.',
          finishedAt: new Date().toISOString(),
        });
      }
      return;
    }
    await patchRun({ totalChunks: chunks.length, status: 'embedding' });
    const chunksPerDocument = new Map<string, number>();
    const processedPerDocument = new Map<string, number>();
    const indexedDocumentIds = new Set<string>();
    for (const chunk of chunks) {
      chunksPerDocument.set(chunk.documentId, (chunksPerDocument.get(chunk.documentId) ?? 0) + 1);
    }

    // 2) Prepare the store
    const adapter = await createAdapter(config, async (waitSecs, attempt) => {
      await patchRun({
        warning: `Sparse model rate-limited — pausing ${waitSecs}s (retry ${attempt}/${3})…`,
      });
    });
    let dimensions = expectedDimensions(config);

    // 3) Embed + upsert in batches
    let processed = 0;
    let initialized = false;
    let currentDelayMs = 0;

    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const batch = chunks.slice(i, i + EMBED_BATCH);

      if (currentDelayMs > 0) {
        await new Promise((r) => setTimeout(r, currentDelayMs));
      }

      await patchRun({ status: 'embedding' });

      let attempt = 1;
      let batchEmbeddings: number[][] = [];
      let batchDimensions = dimensions;

      while (true) {
        try {
          const { embeddings, dimensions: dim } = await embedTexts(
            config,
            batch.map((c) => c.text),
          );
          batchEmbeddings = embeddings;
          if (dim) batchDimensions = dim;
          break; // success
        } catch (err: any) {
          if (isRateLimitError(err) && attempt <= MAX_RATE_LIMIT_RETRIES) {
            const waitMs = rateLimitDelayMs(err, attempt);
            const waitSecs = Math.ceil(waitMs / 1_000);
            await patchRun({
              warning: `Embedding provider quota reached — pausing ${waitSecs}s (retry ${attempt}/${MAX_RATE_LIMIT_RETRIES})…`,
            });
            await new Promise((r) => setTimeout(r, waitMs));
            currentDelayMs = Math.max(currentDelayMs, 2000);
            attempt++;
          } else {
            throw err;
          }
        }
      }

      dimensions = batchDimensions;

      if (!initialized) {
        await adapter.init(dimensions);
        if (!previousRun) {
          await adapter.reset();
          // A full rebuild has now removed the old vectors. Reflect that
          // immediately so an interruption never leaves stale "Indexed" UI.
          await updateDocumentsStatus(
            docs.map((document) => document.id),
            'unindexed',
          );
        }
        initialized = true;
        await patchRun({ dimensions });
      }

      const records: VectorRecord[] = batch.map((c, j) => ({
        id: c.id,
        vector: batchEmbeddings[j],
        text: c.text,
        title: c.title,
        url: c.url,
        source: c.source,
        documentId: c.documentId,
        chunkIndex: c.index,
        metadata: c.metadata,
      }));

      await patchRun({ status: 'upserting' });

      let upsertAttempt = 1;
      while (true) {
        try {
          await adapter.upsert(records);
          break; // success
        } catch (err: any) {
          if (isRateLimitError(err) && upsertAttempt <= MAX_RATE_LIMIT_RETRIES) {
            const waitMs = rateLimitDelayMs(err, upsertAttempt);
            const waitSecs = Math.ceil(waitMs / 1_000);
            await patchRun({
              warning: `Vector store rate-limited — pausing ${waitSecs}s (retry ${upsertAttempt}/${MAX_RATE_LIMIT_RETRIES})…`,
            });
            await new Promise((r) => setTimeout(r, waitMs));
            currentDelayMs = Math.max(currentDelayMs, 2000);
            upsertAttempt++;
          } else {
            throw err;
          }
        }
      }

      processed += batch.length;
      const completedDocumentIds: string[] = [];
      for (const chunk of batch) {
        const completed = (processedPerDocument.get(chunk.documentId) ?? 0) + 1;
        processedPerDocument.set(chunk.documentId, completed);
        if (
          completed === chunksPerDocument.get(chunk.documentId) &&
          !indexedDocumentIds.has(chunk.documentId)
        ) {
          indexedDocumentIds.add(chunk.documentId);
          completedDocumentIds.push(chunk.documentId);
        }
      }
      // Commit status only after a successful upsert. If a later batch
      // exhausts quota, completed files remain searchable and the rest stay
      // visibly retryable.
      if (completedDocumentIds.length > 0) {
        await updateDocumentsStatus(completedDocumentIds, 'indexed');
      }
      await patchRun({
        processedChunks: processed,
        indexedDocumentCount: indexedDocumentIds.size,
        status: 'embedding',
        warning: undefined,
      });
    }

    await patchRun({
      status: 'completed',
      processedChunks: processed,
      dimensions,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
    });
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : 'Indexing failed unexpectedly.';
    const completed = await readDocuments().then(
      (documents) => documents.filter((document) => document.status === 'indexed').length,
    );
    const message = isRateLimitError(err)
      ? `Embedding quota is still unavailable. ${completed} document${
          completed === 1 ? '' : 's'
        } remain indexed; retry the unindexed files when your provider quota resets. ${rawMessage}`
      : rawMessage;
    await patchStoredRun(
      {
        status: 'failed',
        error: message,
        indexedDocumentCount: completed,
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
      },
      runId,
    );
  }
}
