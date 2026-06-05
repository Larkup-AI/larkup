import type { RagConfig } from "@buddy-rag/core/types"
import type { VectorStoreAdapter } from "./adapter"

/**
 * Build the right adapter from the persisted config. Centralizing this keeps
 * the indexer + retrieval store-agnostic — they only ever see the interface.
 *
 * Adapters are imported lazily (dynamic import) so a heavy/native engine like
 * LanceDB is only loaded when it's actually the selected store. This keeps the
 * indexing route from crashing at module-eval time if one engine's native
 * binding isn't available in the current environment.
 */
export async function createAdapter(
  config: RagConfig,
): Promise<VectorStoreAdapter> {
  switch (config.vectorStore) {
    case "pinecone": {
      const { PineconeAdapter } = await import(
        "./pinecone-adapter"
      )
      return new PineconeAdapter({
        apiKey: config.storeConfig.apiKey,
        indexName: config.storeConfig.indexName,
        namespace: config.storeConfig.namespace,
        sparseModel: config.storeConfig.sparseModel,
        sparseIndexName: config.storeConfig.sparseIndexName,
        indexType: config.indexType,
      })
    }
    case "lancedb":
    default: {
      const { LanceDBAdapter } = await import(
        "./lancedb-adapter"
      )
      return new LanceDBAdapter({
        mode: config.storeConfig.mode,
        dbPath: config.storeConfig.dbPath,
        uri: config.storeConfig.uri,
        apiKey: config.storeConfig.apiKey,
        tableName: config.storeConfig.tableName,
      })
    }
  }
}
