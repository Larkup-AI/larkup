import type { RagConfig } from "@larkup/core/types";
import type { VectorStoreAdapter } from "./adapters/base";

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
  onRateLimit?: (waitSecs: number, attempt: number) => void | Promise<void>,
): Promise<VectorStoreAdapter> {
  switch (config.vectorStore) {
    case "pinecone": {
      const { PineconeAdapter } = await import("./adapters/pinecone");
      return new PineconeAdapter({
        apiKey: config.storeConfig.apiKey,
        indexName: config.storeConfig.indexName,
        namespace: config.storeConfig.namespace,
        sparseModel: config.storeConfig.sparseModel,
        indexType: config.indexType,
        onRateLimit,
      });
    }
    case "chroma": {
      const { ChromaAdapter } = await import("./adapters/chroma");
      return new ChromaAdapter({
        mode: config.storeConfig.mode,
        host: config.storeConfig.host,
        authToken: config.storeConfig.authToken,
        apiKey: config.storeConfig.apiKey,
        tenant: config.storeConfig.tenant,
        database: config.storeConfig.database,
        collectionName: config.storeConfig.collectionName,
        indexType: config.indexType,
      });
    }
    case "lancedb":
    default: {
      const { LanceDBAdapter } = await import("./adapters/lancedb");
      return new LanceDBAdapter({
        mode: config.storeConfig.mode,
        dbPath: config.storeConfig.dbPath,
        uri: config.storeConfig.uri,
        apiKey: config.storeConfig.apiKey,
        tableName: config.storeConfig.tableName,
      });
    }
  }

}
