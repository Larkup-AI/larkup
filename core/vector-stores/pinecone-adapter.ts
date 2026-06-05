import { Pinecone, type Index } from "@pinecone-database/pinecone"
import type {
  QueryHit,
  VectorRecord,
  VectorStoreAdapter,
} from "@/core/vector-stores/adapter"

/**
 * Pinecone adapter — fully-managed cloud vector DB.
 *
 * We create the index on demand (serverless, cosine) if it doesn't exist, then
 * upsert into the configured namespace. Metadata carries the chunk text +
 * citation fields so retrieval can return them without a second lookup.
 */

interface PineconeConfig {
  apiKey?: string
  indexName?: string
  namespace?: string
}

interface PineMeta {
  text: string
  title: string
  url: string
  source: string
  documentId: string
  chunkIndex: number
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

  async init(dimensions: number): Promise<void> {
    const pc = this.getClient()
    const { indexes } = await pc.listIndexes()
    const exists = (indexes ?? []).some((i) => i.name === this.indexName)

    if (!exists) {
      await pc.createIndex({
        name: this.indexName,
        dimension: dimensions,
        metric: "cosine",
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
    try {
      await this.ns().deleteAll()
    } catch {
      // namespace may not exist yet — that's fine for a fresh index
    }
  }

  async upsert(records: VectorRecord[]): Promise<void> {
    if (records.length === 0) return
    await this.ns().upsert({
      records: records.map((r) => ({
        id: r.id,
        values: r.vector,
        metadata: {
          text: r.text,
          title: r.title,
          url: r.url ?? "",
          source: r.source,
          documentId: r.documentId,
          chunkIndex: r.chunkIndex,
        } satisfies PineMeta,
      })),
    })
  }

  async count(): Promise<number | null> {
    try {
      const stats = await this.ns().describeIndexStats()
      return stats.namespaces?.[this.namespace]?.recordCount ?? stats.totalRecordCount ?? 0
    } catch {
      return null
    }
  }

  async query(vector: number[], topK: number): Promise<QueryHit[]> {
    const res = await this.ns().query({
      vector,
      topK,
      includeMetadata: true,
    })
    return (res.matches ?? []).map((m) => {
      const meta = (m.metadata ?? {}) as unknown as PineMeta
      return {
        id: m.id,
        score: m.score ?? 0,
        text: meta.text ?? "",
        title: meta.title ?? "Untitled",
        url: meta.url || undefined,
        documentId: meta.documentId ?? "",
      }
    })
  }

  async testConnection(): Promise<void> {
    const pc = this.getClient()
    await pc.listIndexes()
  }
}
