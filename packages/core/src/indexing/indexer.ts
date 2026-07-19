import { randomUUID } from "node:crypto"
import type { IndexRun, RagConfig } from "../types"
import { readDocuments, updateDocumentsStatus } from "../documents-store"
import { patchRun, writeRun } from "../index-store"
import { chunkCorpus } from "./chunker"
import { embedTexts, expectedDimensions } from "./embedder"
import { createAdapter } from "@larkup/vector-stores/factory"
import type { VectorRecord } from "@larkup/vector-stores/adapter"

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
    dimensions: expectedDimensions(config),
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
  previousRun: IndexRun | null = null,
): Promise<void> {
  const started = Date.now()
  try {
    let docs = await readDocuments()
    
    if (previousRun && previousRun.status === "completed") {
      docs = docs.filter(d => d.createdAt > previousRun.startedAt)
    }

    if (docs.length === 0) {
      if (previousRun) {
        await patchRun({
          status: "completed",
          docCount: 0,
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - started,
        })
      } else {
        await patchRun({
          status: "failed",
          error: "The corpus is empty. Load documents before indexing.",
          finishedAt: new Date().toISOString(),
        })
      }
      return
    }

    // 1) Chunk
    await patchRun({ status: "chunking", docCount: docs.length })
    const chunks = chunkCorpus(docs, config.chunking)
    if (chunks.length === 0) {
      if (previousRun) {
        await patchRun({
          status: "completed",
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - started,
        })
      } else {
        await patchRun({
          status: "failed",
          error: "No chunks were produced from the corpus.",
          finishedAt: new Date().toISOString(),
        })
      }
      return
    }
    await patchRun({ totalChunks: chunks.length, status: "embedding" })

    // 2) Prepare the store
    const adapter = await createAdapter(config, async (waitSecs, attempt) => {
      await patchRun({
        warning: `Sparse model rate-limited — pausing ${waitSecs}s (retry ${attempt}/${3})…`,
      })
    })
    let dimensions = expectedDimensions(config)

    // 3) Embed + upsert in batches
    let processed = 0
    let initialized = false
    let currentDelayMs = 0

    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const batch = chunks.slice(i, i + EMBED_BATCH)

      if (currentDelayMs > 0) {
        await new Promise((r) => setTimeout(r, currentDelayMs))
      }

      await patchRun({ status: "embedding" })
      
      let attempt = 1
      let batchEmbeddings: number[][] = []
      let batchDimensions = dimensions
      
      while (true) {
        try {
          const { embeddings, dimensions: dim } = await embedTexts(
            config,
            batch.map((c) => c.text),
          )
          batchEmbeddings = embeddings
          if (dim) batchDimensions = dim
          break // success
        } catch (err: any) {
          const is429 = err?.status === 429 || err?.statusCode === 429 || String(err?.message ?? "").includes("429") || String(err?.message ?? "").includes("rate limit") || String(err?.message ?? "").toLowerCase().includes("too many requests")
          if (is429 && attempt <= 3) {
            const waitSecs = attempt * 10
            await patchRun({
              warning: `Dense model rate-limited — pausing ${waitSecs}s (retry ${attempt}/${3})…`,
            })
            await new Promise((r) => setTimeout(r, waitSecs * 1000))
            currentDelayMs = Math.max(currentDelayMs, 2000)
            attempt++
          } else {
            throw err
          }
        }
      }
      
      dimensions = batchDimensions

      // Initialize + reset the store once we know the real vector size.
      if (!initialized) {
        await adapter.init(dimensions)
        if (!previousRun) {
          await adapter.reset()
        }
        initialized = true
        await patchRun({ dimensions })
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
      }))

      await patchRun({ status: "upserting" })
      
      let upsertAttempt = 1
      while (true) {
         try {
           await adapter.upsert(records)
           break // success
         } catch (err: any) {
            const is429 = err?.status === 429 || err?.statusCode === 429 || String(err?.message ?? "").includes("429") || String(err?.message ?? "").includes("rate limit") || String(err?.message ?? "").toLowerCase().includes("too many requests") || String(err?.message ?? "").includes("RESOURCE_EXHAUSTED")
            if (is429 && upsertAttempt <= 3) {
               const waitSecs = upsertAttempt * 10
               await patchRun({
                 warning: `Vector store rate-limited — pausing ${waitSecs}s (retry ${upsertAttempt}/${3})…`,
               })
               await new Promise((r) => setTimeout(r, waitSecs * 1000))
               currentDelayMs = Math.max(currentDelayMs, 2000)
               upsertAttempt++
            } else {
               throw err
            }
         }
      }

      processed += batch.length
      await patchRun({ processedChunks: processed, status: "embedding", warning: undefined })
    }

    await patchRun({
      status: "completed",
      processedChunks: processed,
      dimensions,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
    })

    // Mark processed documents as indexed
    await updateDocumentsStatus(docs.map(d => d.id), "indexed")
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
