import { Pinecone, type Index, type RecordSparseValues } from "@pinecone-database/pinecone"
import type {
  QueryHit,
  VectorRecord,
  VectorStoreAdapter,
} from "./adapter"

/**
 * Pinecone adapter — fully-managed cloud vector DB.
 *
 * ── Semantic (dense-only) ──────────────────────────────────────────────────
 *   Index metric: cosine (or dotproduct)
 *   Upsert: dense `values` only.
 *   Query:  pure vector ANN search.
 *
 * ── Hybrid / Lexical ───────────────────────────────────────────────────────
 *   Index metric: MUST be dotproduct
 *   Upsert: dense `values` + sparse `sparseValues` in the SAME record.
 *           Sparse vectors are generated via Pinecone Inference API.
 *   Query:  dense ANN + sparse keyword search run in parallel,
 *           merged via Reciprocal Rank Fusion (RRF, k=60).
 *
 * ── Rate limiting ─────────────────────────────────────────────────────────
 *   Pinecone's free plan caps the sparse model at 250k tokens/min.
 *   The adapter uses a conservative batch size + inter-batch delay to stay
 *   within that budget. On a 429 it pauses and retries automatically, calling
 *   the optional `onRateLimit` hook so the caller can surface a UI warning.
 */

interface PineconeConfig {
  apiKey?: string
  indexName?: string
  namespace?: string
  /** Pinecone Inference sparse model. Required for hybrid/lexical. */
  sparseModel?: string
  /** indexType drives whether sparse vectors are generated */
  indexType?: string
  /**
   * Called just before each rate-limit sleep so the caller can update UI.
   * `waitSecs` is how long we'll wait; `attempt` is which retry (1-based).
   */
  onRateLimit?: (waitSecs: number, attempt: number) => void | Promise<void>
}

/** Must carry an index-signature to satisfy RecordMetadata */
interface PineMeta {
  text: string
  title: string
  url: string
  source: string
  documentId: string
  chunkIndex: number
  [key: string]: string | number | boolean | string[]
}

/**
 * Chunks per Inference API call.
 * 48 chunks × 512 tokens (max) = 24,576 tokens per batch.
 * With INTER_BATCH_DELAY_MS between calls that keeps us comfortably
 * under Pinecone's 250k tokens/min starter limit.
 */
const SPARSE_BATCH = 48

/**
 * Delay between consecutive sparse-embed batches (ms).
 * 48 chunks × 512 tokens = 24,576 tokens; 250,000 ÷ 24,576 ≈ 10 safe
 * batches/min → at least 6 000 ms between calls to stay in budget.
 * We use 7 000 ms to give a comfortable margin.
 */
const INTER_BATCH_DELAY_MS = 7_000

/** How long to wait on a 429 before retrying (ms). */
const RATE_LIMIT_WAIT_MS = 65_000

/** Maximum number of 429-retry attempts per batch. */
const RATE_LIMIT_MAX_RETRIES = 3

/** RRF constant */
const RRF_K = 60

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

function is429(err: unknown): boolean {
  const e = err as any
  return (
    e?.status === 429 ||
    e?.statusCode === 429 ||
    String(e?.message ?? "").includes("429") ||
    String(e?.message ?? "").includes("RESOURCE_EXHAUSTED")
  )
}

export class PineconeAdapter implements VectorStoreAdapter {
  private client: Pinecone | null = null
  private index: Index | null = null
  private readonly indexName: string
  private readonly namespace: string

  constructor(private readonly config: PineconeConfig) {
    if (!config.apiKey) throw new Error("Pinecone requires an API key.")
    if (!config.indexName) throw new Error("Pinecone requires an index name.")
    this.indexName = config.indexName.trim()
    this.namespace = config.namespace?.trim() || "default"
  }

  private getClient() {
    if (!this.client) {
      this.client = new Pinecone({ apiKey: this.config.apiKey as string })
    }
    return this.client
  }

  private get needsSparse() {
    return (
      this.config.indexType === "lexical" ||
      this.config.indexType === "hybrid"
    )
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async init(dimensions: number): Promise<void> {
    const pc = this.getClient()
    const { indexes } = await pc.listIndexes()
    const exists = (indexes ?? []).some((i) => i.name === this.indexName)

    if (!exists) {
      const metric = this.needsSparse ? "dotproduct" : "cosine"
      await pc.createIndex({
        name: this.indexName,
        dimension: dimensions,
        metric,
        spec: { serverless: { cloud: "aws", region: "us-east-1" } },
        waitUntilReady: true,
      })
    }
    this.index = pc.index(this.indexName)
  }

  private ns() {
    if (!this.index) this.index = this.getClient().index(this.indexName)
    return this.index.namespace(this.namespace)
  }

  async reset(): Promise<void> {
    try { await this.ns().deleteAll() } catch { /* fresh index — ok */ }
  }

  // ── Sparse vector generation with rate-limit handling ─────────────────────

  /**
   * Call Pinecone Inference API for one batch of texts, retrying on 429.
   * Before each retry-sleep the `onRateLimit` hook is called so the indexer
   * can patch the run store with a warning that the UI polls.
   */
  private async embedSparseWithRetry(texts: string[]): Promise<RecordSparseValues[]> {
    const pc = this.getClient()

    for (let attempt = 1; attempt <= RATE_LIMIT_MAX_RETRIES + 1; attempt++) {
      try {
        const result = await pc.inference.embed({
          model: this.config.sparseModel!,
          inputs: texts,
          parameters: { input_type: "passage", truncate: "END" },
        })
        return result.data.map((emb) => {
          const s = emb as any
          return {
            indices: (s.sparseIndices as number[]) ?? [],
            values:  (s.sparseValues  as number[]) ?? [],
          }
        })
      } catch (err) {
        if (is429(err) && attempt <= RATE_LIMIT_MAX_RETRIES) {
          const waitSecs = Math.round(RATE_LIMIT_WAIT_MS / 1000)
          await this.config.onRateLimit?.(waitSecs, attempt)
          await sleep(RATE_LIMIT_WAIT_MS)
          continue
        }
        throw err
      }
    }
    // Unreachable but TypeScript needs it
    throw new Error("Sparse embedding failed after max retries.")
  }

  private async buildSparseVectors(texts: string[]): Promise<RecordSparseValues[]> {
    const result: RecordSparseValues[] = []

    for (let i = 0; i < texts.length; i += SPARSE_BATCH) {
      const batch = texts.slice(i, i + SPARSE_BATCH)
      const vecs = await this.embedSparseWithRetry(batch)
      result.push(...vecs)

      // Rate-limit guard: delay between batches (skip after the last one)
      if (i + SPARSE_BATCH < texts.length) {
        await sleep(INTER_BATCH_DELAY_MS)
      }
    }

    return result
  }

  private async buildQuerySparseVector(text: string): Promise<RecordSparseValues> {
    const pc = this.getClient()

    for (let attempt = 1; attempt <= RATE_LIMIT_MAX_RETRIES + 1; attempt++) {
      try {
        const result = await pc.inference.embed({
          model: this.config.sparseModel!,
          inputs: [text],
          parameters: { input_type: "query", truncate: "END" },
        })
        const s = result.data[0] as any
        return {
          indices: (s.sparseIndices as number[]) ?? [],
          values:  (s.sparseValues  as number[]) ?? [],
        }
      } catch (err) {
        if (is429(err) && attempt <= RATE_LIMIT_MAX_RETRIES) {
          await sleep(RATE_LIMIT_WAIT_MS)
          continue
        }
        throw err
      }
    }
    throw new Error("Sparse query embedding failed after max retries.")
  }

  // ── Upsert ─────────────────────────────────────────────────────────────────

  async upsert(records: VectorRecord[]): Promise<void> {
    if (records.length === 0) return

    const metaOf = (r: VectorRecord): PineMeta => ({
      text: r.text,
      title: r.title,
      url: r.url ?? "",
      source: r.source,
      documentId: r.documentId,
      chunkIndex: r.chunkIndex,
    })

    if (!this.needsSparse || !this.config.sparseModel) {
      // ── Semantic-only ──────────────────────────────────────────────────────
      await this.ns().upsert({
        records: records.map((r) => ({
          id: r.id,
          values: r.vector,
          metadata: metaOf(r),
        })),
      })
      return
    }

    // ── Hybrid / Lexical ───────────────────────────────────────────────────
    const sparseVecs = await this.buildSparseVectors(records.map((r) => r.text))

    await this.ns().upsert({
      records: records.map((r, i) => ({
        id: r.id,
        values: r.vector,
        sparseValues: sparseVecs[i],
        metadata: metaOf(r),
      })),
    })
  }

  // ── Query ──────────────────────────────────────────────────────────────────

  async query(vector: number[], topK: number, queryText?: string): Promise<QueryHit[]> {
    const canHybrid = this.needsSparse && this.config.sparseModel && queryText

    if (!canHybrid) {
      return this.denseQuery(vector, topK)
    }

    const fetchN = Math.min(topK * 2, 100)
    const [denseHits, sparseHits] = await Promise.all([
      this.denseQuery(vector, fetchN),
      this.sparseQuery(queryText!, fetchN),
    ])

    return rrfMerge(denseHits, sparseHits, topK)
  }

  private async denseQuery(vector: number[], topK: number): Promise<QueryHit[]> {
    const res = await this.ns().query({ vector, topK, includeMetadata: true })
    return (res.matches ?? []).map(hitFromMatch)
  }

  private async sparseQuery(queryText: string, topK: number): Promise<QueryHit[]> {
    const sparseVector = await this.buildQuerySparseVector(queryText)
    const res = await this.ns().query({
      vector: [],
      sparseVector,
      topK,
      includeMetadata: true,
    } as any)
    return (res.matches ?? []).map(hitFromMatch)
  }

  // ── Count ──────────────────────────────────────────────────────────────────

  async count(): Promise<number | null> {
    try {
      const stats = await this.ns().describeIndexStats()
      return (
        stats.namespaces?.[this.namespace]?.recordCount ??
        stats.totalRecordCount ??
        0
      )
    } catch {
      return null
    }
  }

  // ── Connection test ────────────────────────────────────────────────────────

  async testConnection(dimensions: number): Promise<void> {
    const pc = this.getClient()
    let indexList
    try {
      indexList = await pc.listIndexes()
    } catch (err: any) {
      if (
        err.message?.toLowerCase().includes("api key") ||
        err.name === "PineconeAuthorizationError" ||
        err.status === 401
      ) {
        throw new Error("Invalid Pinecone API key.")
      }
      throw new Error(`Failed to connect to Pinecone: ${err.message}`)
    }

    const indexModel = (indexList.indexes ?? []).find(
      (i) => i.name === this.indexName,
    )
    if (!indexModel) {
      throw new Error(
        `Index "${this.indexName}" does not exist in your Pinecone project. Please create it first.`,
      )
    }

    if (indexModel.dimension !== dimensions) {
      throw new Error(
        `Dimension mismatch: Index "${this.indexName}" has dimension ${indexModel.dimension}, but the selected embedding model requires dimension ${dimensions}.`,
      )
    }

    if (this.needsSparse) {
      if (!this.config.sparseModel) {
        throw new Error(
          "Hybrid/lexical search requires a sparse model to be selected.",
        )
      }

      const metric =
        (indexModel as any).metric ??
        (indexModel as any).spec?.metric
      if (metric && metric !== "dotproduct") {
        throw new Error(
          `Hybrid/lexical requires your Pinecone index to use the "dotproduct" metric, ` +
          `but "${this.indexName}" uses "${metric}". ` +
          `Please delete and recreate the index with metric = dotproduct.`,
        )
      }
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function hitFromMatch(m: any): QueryHit {
  const meta = (m.metadata ?? {}) as PineMeta
  return {
    id: m.id,
    score: m.score ?? 0,
    text:  (meta.text       as string) ?? "",
    title: (meta.title      as string) ?? "Untitled",
    url:   (meta.url as string) || undefined,
    documentId: (meta.documentId as string) ?? "",
  }
}

function rrfMerge(denseHits: QueryHit[], sparseHits: QueryHit[], topK: number): QueryHit[] {
  const scores = new Map<string, { hit: QueryHit; score: number }>()

  const addList = (hits: QueryHit[]) =>
    hits.forEach((hit, rank) => {
      const contrib = 1 / (RRF_K + rank + 1)
      const prev = scores.get(hit.id)
      if (prev) { prev.score += contrib } else { scores.set(hit.id, { hit, score: contrib }) }
    })

  addList(denseHits)
  addList(sparseHits)

  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ hit, score }) => ({ ...hit, score }))
}
