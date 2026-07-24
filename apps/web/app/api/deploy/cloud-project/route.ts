import { NextResponse } from 'next/server';
import { readConfig, writeConfig } from '@larkup/core/config-store';
import { readDocuments, replaceDocuments } from '@larkup/core/documents-store';
import { createRun, runIndexer } from '@larkup/core/indexing/indexer';
import { createServer, runWithServer, setActiveServer } from '@larkup/core/workspace';
import { createAdapter } from '@larkup/vector-stores/factory';
import { getVectorStore, validateStoreConfig } from '@larkup/vector-stores/registry';
import type { IndexType, RagConfig, VectorStoreId } from '@larkup/core/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CloudProjectRequest = {
  sourceServerId: string;
  name?: string;
  vectorStore: VectorStoreId;
  storeConfig: Record<string, string>;
  indexType?: IndexType;
  copyKnowledgeBase?: boolean;
  embeddingModelId?: string;
};

function requiresCloudStorage(config: Pick<RagConfig, 'vectorStore' | 'storeConfig'>) {
  return config.vectorStore === 'lancedb' && (config.storeConfig.mode ?? 'local') === 'local';
}

async function getEmbeddingDimensions(config: RagConfig) {
  if (config.embeddingModelId.startsWith('custom:')) {
    const modelName = config.embeddingModelId.slice('custom:'.length);
    return (
      config.customEmbeddings?.find((model) => model.modelName === modelName)?.dimensions ?? 1536
    );
  }

  const { getEmbeddingModel, EMBEDDING_DIMENSIONS } = await import(
    '@larkup/core/embeddings/registry'
  );
  return (
    getEmbeddingModel(config.embeddingModelId)?.dimensions ??
    EMBEDDING_DIMENSIONS[config.embeddingModelId]?.dimensions ??
    768
  );
}

/**
 * Creates an isolated cloud-ready project. Raw source documents can be copied
 * and re-indexed, but the existing local vectors are intentionally never
 * transferred because they are incompatible with a different vector store.
 */
export async function POST(request: Request) {
  let body: CloudProjectRequest;
  try {
    body = (await request.json()) as CloudProjectRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const store = getVectorStore(body.vectorStore);
  if (!store || store.installStatus === 'coming-soon') {
    return NextResponse.json({ error: 'Select an available storage engine.' }, { status: 400 });
  }
  const fieldErrors = validateStoreConfig(store, body.storeConfig ?? {}, body.indexType);
  if (Object.keys(fieldErrors).length > 0) {
    return NextResponse.json(
      { error: 'Complete the required storage fields.', fieldErrors },
      { status: 422 },
    );
  }
  if (requiresCloudStorage({ vectorStore: body.vectorStore, storeConfig: body.storeConfig })) {
    return NextResponse.json({ error: 'Choose cloud storage for deployment.' }, { status: 422 });
  }

  const source = await runWithServer(body.sourceServerId, async () => ({
    config: await readConfig(),
    documents: body.copyKnowledgeBase ? await readDocuments() : [],
  }));
  const storageConfig: RagConfig = {
    ...source.config,
    vectorStore: body.vectorStore,
    storeConfig: body.storeConfig,
    embeddingModelId: body.embeddingModelId || source.config.embeddingModelId,
  };
  try {
    const adapter = await createAdapter(storageConfig);
    await adapter.testConnection(await getEmbeddingDimensions(storageConfig));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Storage connection failed.' },
      { status: 400 },
    );
  }
  const { server } = await createServer(body.name?.trim() || `${source.config.projectName}-cloud`);
  // Creating a workspace server makes it active by default. The storage selection
  // is isolated to the new cloud project, so keep the source project active.
  await setActiveServer(body.sourceServerId);

  const config = await runWithServer(server.id, async () => {
    const nextConfig: RagConfig = {
      ...source.config,
      projectName: body.name?.trim() || `${source.config.projectName}-cloud`,
      vectorStore: body.vectorStore,
      storeConfig: body.storeConfig,
      embeddingModelId: body.embeddingModelId || source.config.embeddingModelId,
      updatedAt: new Date().toISOString(),
    };
    await writeConfig(nextConfig);
    if (source.documents.length > 0) await replaceDocuments(source.documents);
    return nextConfig;
  });

  let run = null;
  if (source.documents.length > 0) {
    run = await runWithServer(server.id, async () => {
      const nextRun = await createRun(config);
      // Run the indexer asynchronously but ensure it stays within the new server's context
      void runWithServer(server.id, () => runIndexer(nextRun.id, config));
      return nextRun;
    });
  }

  return NextResponse.json(
    { server, copiedDocuments: source.documents.length, run },
    { status: 201 },
  );
}
