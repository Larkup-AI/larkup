import type { VectorStoreAdapter } from './adapters/base';
import type { VectorStoreConfig } from './types';

/** Creates the configured adapter with lazy provider imports. */
export async function createAdapter(
  config: VectorStoreConfig,
  onRateLimit?: (waitSecs: number, attempt: number) => void | Promise<void>,
): Promise<VectorStoreAdapter> {
  const overrides = { ...config.storeConfig };
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
        s3Uri: overrides.s3Uri,
        s3Endpoint: overrides.s3Endpoint,
        s3Region: overrides.s3Region,
        s3AccessKeyId: overrides.s3AccessKeyId,
        s3SecretAccessKey: overrides.s3SecretAccessKey,
        tableName: overrides.tableName,
      });
    }
  }
}
