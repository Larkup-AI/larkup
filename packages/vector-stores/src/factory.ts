import type { RagConfig } from '@larkup/core/types';
import type { VectorStoreAdapter } from './adapters/base';
import { getActiveServer } from '@larkup/core/workspace';

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
  const overrides = { ...config.storeConfig };
  const server = await getActiveServer();
  const serverId = server?.id;

  if (serverId) {
    const safeId = serverId.replace(/[^a-zA-Z0-9_-]/g, '_');
    if (config.vectorStore === 'pinecone') {
      overrides.namespace = serverId;
    } else if (config.vectorStore === 'chroma') {
      overrides.collectionName = `documents_${safeId}`;
    } else if (config.vectorStore === 'lancedb' || !config.vectorStore) {
      overrides.tableName = `documents_${safeId}`;
    }
  }

  switch (config.vectorStore) {
    case 'pinecone': {
      const { PineconeAdapter } = await import('./adapters/pinecone');
      return new PineconeAdapter({
        apiKey: overrides.apiKey,
        indexName: overrides.indexName,
        namespace: overrides.namespace,
        sparseModel: overrides.sparseModel,
        indexType: config.indexType,
        onRateLimit,
      });
    }
    case 'chroma': {
      const { ChromaAdapter } = await import('./adapters/chroma');
      return new ChromaAdapter({
        mode: overrides.mode,
        host: overrides.host,
        authToken: overrides.authToken,
        apiKey: overrides.apiKey,
        tenant: overrides.tenant,
        database: overrides.database,
        collectionName: overrides.collectionName,
        indexType: config.indexType,
      });
    }
    case 'lancedb':
    default: {
      const { LanceDBAdapter } = await import('./adapters/lancedb');
      return new LanceDBAdapter({
        mode: overrides.mode,
        dbPath: overrides.dbPath,
        uri: overrides.uri,
        apiKey: overrides.apiKey,
        tableName: overrides.tableName,
      });
    }
  }
}
