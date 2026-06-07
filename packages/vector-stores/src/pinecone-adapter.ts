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
 *           Sparse vectors are generated via the Pinecone Inference API
 *           using the configured `sparseModel`
 *           (default: "pinecone-sparse-english-v0").
 *   Query:  dense ANN + sparse keyword search run in parallel,
 *           results merged with Reciprocal Rank Fusion (RRF, k=60).
 *
 * There is only ONE Pinecone index involved. The same `indexName` index
 * stores both dense and sparse vectors per record. No separate sparse index
 * is needed or used.
 */

interface PineconeConfig {
  apiKey?: string
  indexName?: string
  namespace?: string
  /** Pinecone Inference sparse model. Required for hybrid/lexical. */
  sparseModel?: string
  /** indexType drives whether sparse vectors are generated */
  indexType?: string
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

/** Batch size for Pinecone Inference API sparse embed calls */
const SPARSE_BATCH = 96

/** RRF constant — larger k reduces the impact of high-rank differences */
const RRF_K = 60

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
      // Hybrid/lexical requires dotproduct; semantic works with cosine.
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

  // ── Sparse vector generation via Pinecone Inference API ───────────────────

  private async buildSparseVectors(texts: string[]): Promise<RecordSparseValues[]> {
    const pc = this.getClient()
    const result: RecordSparseValues[] = []

    for (let i = 0; i < texts.length; i += SPARSE_BATCH) {
      const batch = texts.slice(i, i + SPARSE_BATCH)
      const embedResult = await pc.inference.embed({
        model: this.config.sparseModel!,
        inputs: batch,
        parameters: { input_type: "passage", truncate: "END" },
      })
      for (const emb of embedResult.data) {
        const s = emb as any
        result.push({
          indices: (s.sparseIndices as number[]) ?? [],
          values:  (s.sparseValues  as number[]) ?? [],
        })
      }
    }
    return result
  }

  private async buildQuerySparseVector(text: string): Promise<RecordSparseValues> {
    const pc = this.getClient()
    const embedResult = await pc.inference.embed({
      model: this.config.sparseModel!,
      inputs: [text],
      parameters: { input_type: "query", truncate: "END" },
    })
    const s = embedResult.data[0] as any
    return {
      indices: (s.sparseIndices as number[]) ?? [],
      values:  (s.sparseValues  as number[]) ?? [],
    }
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
      // ── Semantic-only: dense upsert ────────────────────────────────────────
      await this.ns().upsert({
        records: records.map((r) => ({
          id: r.id,
          values: r.vector,
          metadata: metaOf(r),
        })),
      })
      return
    }

    // ── Hybrid / Lexical: dense + sparse in same record ────────────────────
    // Generate sparse vectors for all chunk texts via Pinecone Inference API
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

  /**
   * Semantic: pure dense ANN search.
   *
   * Hybrid/Lexical (when `queryText` is provided):
   *   1. Dense ANN search  → semantic relevance ranking.
   *   2. Generate sparse vector for `queryText` → keyword relevance ranking.
   *   3. Merge both ranked lists with Reciprocal Rank Fusion (RRF, k=60).
   *
   * If `queryText` is omitted the adapter falls back to dense-only search.
   */
  async query(vector: number[], topK: number, queryText?: string): Promise<QueryHit[]> {
    const canHybrid = this.needsSparse && this.config.sparseModel && queryText

    if (!canHybrid) {
      return this.denseQuery(vector, topK)
    }

    // Fetch a larger pool for better RRF coverage, then trim to topK
    const fetchN = Math.min(topK * 2, 100)
    const [denseHits, sparseHits] = await Promise.all([
      this.denseQuery(vector, fetchN),
      this.sparseQuery(queryText!, fetchN),
    ])

    return rrfMerge(denseHits, sparseHits, topK)
  }

  private async denseQuery(vector: number[], topK: number): Promise<QueryHit[]> {
    const res = await this.ns().query({
      vector,
      topK,
      includeMetadata: true,
    })
    return (res.matches ?? []).map(hitFromMatch)
  }

  private async sparseQuery(queryText: string, topK: number): Promise<QueryHit[]> {
    const sparseVector = await this.buildQuerySparseVector(queryText)
    const res = await this.ns().query({
      vector: [],
      sparseVector,
      topK,
      includeMetadata: true,
    } as any) // SDK overload requires vector; API accepts empty for sparse-only
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

      // The single index must use dotproduct so records can carry both
      // dense `values` and sparse `sparseValues` together.
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

/**
 * Reciprocal Rank Fusion merges two ranked lists.
 *   score(d) = Σ  1 / (k + rank(d))   summed over every list d appears in
 * Higher score = better combined rank. De-duplicated by id, trimmed to topK.
 */
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
