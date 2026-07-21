/**
 * Common contract every vector-store adapter implements.
 *
 * The indexer talks to this interface only, so swapping LanceDB ⇆ Pinecone is
 * purely a config change. The same shape is what the Phase 4 generated server
 * will rely on, keeping local + deployed retrieval behaviour identical.
 */

export interface VectorRecord {
  id: string;
  vector: number[];
  text: string;
  title: string;
  url?: string;
  source: string;
  documentId: string;
  chunkIndex: number;
  metadata?: Record<string, any>;
}

export interface QueryHit {
  id: string;
  score: number;
  text: string;
  title: string;
  url?: string;
  documentId: string;
  metadata?: Record<string, any>;
}

export interface VectorStoreAdapter {
  /** Create / connect to the index, sized for `dimensions`. */
  init(dimensions: number): Promise<void>;
  /** Remove all existing vectors (full re-index). */
  reset(): Promise<void>;
  /** Upsert a batch of records. */
  upsert(records: VectorRecord[]): Promise<void>;
  /** Number of vectors currently stored, if cheaply knowable. */
  count(): Promise<number | null>;
  /**
   * Nearest-neighbour search for a query vector.
   * Pass `queryText` for hybrid/lexical stores so they can also generate a
   * sparse vector and merge dense + sparse results (RRF).
   */
  query(vector: number[], topK: number, queryText?: string): Promise<QueryHit[]>;
  /** Test connection to the vector store. Throws if invalid. */
  testConnection(dimensions: number): Promise<void>;
  /** Delete all chunks associated with the given document IDs. */
  deleteByDocumentIds(documentIds: string[]): Promise<void>;
}
