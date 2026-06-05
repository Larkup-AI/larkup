/**
 * Common contract every vector-store adapter implements.
 *
 * The indexer talks to this interface only, so swapping LanceDB ⇆ Pinecone is
 * purely a config change. The same shape is what the Phase 4 generated server
 * will rely on, keeping local + deployed retrieval behaviour identical.
 */

export interface VectorRecord {
  id: string
  vector: number[]
  text: string
  title: string
  url?: string
  source: string
  documentId: string
  chunkIndex: number
}

export interface QueryHit {
  id: string
  score: number
  text: string
  title: string
  url?: string
  documentId: string
}

export interface VectorStoreAdapter {
  /** Create / connect to the index, sized for `dimensions`. */
  init(dimensions: number): Promise<void>
  /** Remove all existing vectors (full re-index). */
  reset(): Promise<void>
  /** Upsert a batch of records. */
  upsert(records: VectorRecord[]): Promise<void>
  /** Number of vectors currently stored, if cheaply knowable. */
  count(): Promise<number | null>
  /** Nearest-neighbour search for a query vector. */
  query(vector: number[], topK: number): Promise<QueryHit[]>
  /** Test connection to the vector store. Throws if invalid. */
  testConnection(): Promise<void>
}
