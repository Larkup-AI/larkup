import { randomUUID } from "node:crypto"
import type { IndexRun, RagConfig } from "@/core/types"
import { readDocuments } from "@/core/documents-store"
import { patchRun, writeRun } from "@/core/index-store"
import { chunkCorpus } from "@/core/indexing/chunker"
import { embedTexts, expectedDimensions } from "@/core/indexing/embedder"
import { createAdapter } from "@/core/vector-stores/factory"
import type { VectorRecord } from "@/core/vector-stores/adapter"

/**
 * The indexing pipeline: corpus → chunks → embeddings → vector store.
 *
 * Runs in the background (fire-and-forget from the API route) and streams
 * progress to the file-backed run store so the UI can poll it. Embedding +
 * upsert happen in batches so memory stays flat and progress is granular even
 * for large corpora.
 */

const EMBED_BATCH = 64

/** Create the initial run record and persist it before work begins. */
export async function createRun(config: RagConfig): Promise<IndexRun> {
  const now = new Date().toISOString()
  const run: IndexRun = {
    id: randomUUID(),
    status: "chunking",
    embeddingModelId: config.embeddingModelId,
    vectorStore: config.vectorStore,
    indexType: config.indexType,
    totalChunks: 0,
    processedChunks: 0,
    docCount: 0,
    dimensions: expectedDimensions(config.embeddingModelId),
    startedAt: now,
    updatedAt: now,
  }
  return writeRun(run)
}

/**
 * Execute the run. Designed to be called WITHOUT awaiting from the route so the
 * HTTP request returns immediately; all progress is observable via the store.
 */
export async function runIndexer(
  runId: string,
  config: RagConfig,
): Promise<void> {
  const started = Date.now()
  try {
    const docs = await readDocuments()
    if (docs.length === 0) {
      await patchRun({
        status: "failed",
        error: "The corpus is empty. Load documents before indexing.",
        finishedAt: new Date().toISOString(),
      })
      return
    }

    // 1) Chunk
    await patchRun({ status: "chunking", docCount: docs.length })
    const chunks = chunkCorpus(docs, config.chunking)
    if (chunks.length === 0) {
      await patchRun({
        status: "failed",
        error: "No chunks were produced from the corpus.",
        finishedAt: new Date().toISOString(),
      })
      return
    }
    await patchRun({ totalChunks: chunks.length, status: "embedding" })

    // 2) Prepare the store (fresh full re-index)
    const adapter = await createAdapter(config)
    let dimensions = expectedDimensions(config.embeddingModelId)

    // 3) Embed + upsert in batches
    let processed = 0
    let initialized = false

    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const batch = chunks.slice(i, i + EMBED_BATCH)

      await patchRun({ status: "embedding" })
      const { embeddings, dimensions: dim } = await embedTexts(
        config.embeddingModelId,
        batch.map((c) => c.text),
      )
      if (dim) dimensions = dim

      // Initialize + reset the store once we know the real vector size.
      if (!initialized) {
        await adapter.init(dimensions)
        await adapter.reset()
        initialized = true
        await patchRun({ dimensions })
      }

      const records: VectorRecord[] = batch.map((c, j) => ({
        id: c.id,
        vector: embeddings[j],
        text: c.text,
        title: c.title,
        url: c.url,
        source: c.source,
        documentId: c.documentId,
        chunkIndex: c.index,
      }))

      await patchRun({ status: "upserting" })
      await adapter.upsert(records)

      processed += batch.length
      await patchRun({ processedChunks: processed, status: "embedding" })
    }

    await patchRun({
      status: "completed",
      processedChunks: processed,
      dimensions,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
    })
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Indexing failed unexpectedly."
    await patchRun({
      status: "failed",
      error: message,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
    })
  }
}
