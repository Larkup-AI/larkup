import { NextResponse } from 'next/server';
import { readConfig } from '@larkup/core/config-store';
import { corpusStats, readDocuments } from '@larkup/core/documents-store';
import { isRunning, readRun } from '@larkup/core/index-store';
import { createRun, runIndexer } from '@larkup/core/indexing/indexer';
import { getEmbeddingModel } from '@larkup/core/embeddings/registry';
import { runWithServer } from '@larkup/core/workspace';
import type { RagConfig } from '@larkup/core/types';

export const dynamic = 'force-dynamic';

/**
 * Assess whether indexing can run with the current config + corpus.
 * Returned to the UI so it can explain exactly what is missing before enabling
 * the "Build index" button.
 */
function assessReadiness(config: RagConfig, docCount: number) {
  const blockers: string[] = [];

  const model = getEmbeddingModel(config.embeddingModelId);
  if (!model && !config.embeddingModelId?.startsWith('custom:'))
    blockers.push('No embedding model is selected.');

  let hasKey = !!config.embeddingApiKey?.trim();
  if (!hasKey) {
    if (config.embeddingModelId?.startsWith('custom:')) {
      const customName = config.embeddingModelId.slice('custom:'.length);
      const custom = (config.customEmbeddings ?? []).find((m) => m.modelName === customName);
      hasKey = !!custom?.apiKey || true; // custom might be local, so we don't strictly block
    } else {
      hasKey = false;
    }
  }

  if (!hasKey) {
    blockers.push('MISSING_EMBEDDING_API_KEY');
  }

  if (docCount === 0) blockers.push('The corpus is empty — load documents in the Data stage.');

  if (config.vectorStore === 'pinecone') {
    if (!config.storeConfig?.apiKey?.trim()) blockers.push('PINECONE_API_KEY is not set.');
    if (!config.storeConfig?.indexName?.trim()) blockers.push('A Pinecone index name is required.');
  }

  return { ready: blockers.length === 0, blockers };
}

export async function GET(request: Request) {
  const serverId = new URL(request.url).searchParams.get('serverId');
  return withServer(serverId, getIndexStatus);
}

async function withServer<T>(serverId: string | null, fn: () => Promise<T>) {
  return serverId ? runWithServer(serverId, fn) : fn();
}

async function getIndexStatus() {
  const [config, stats, run] = await Promise.all([readConfig(), corpusStats(), readRun()]);
  const { ready, blockers } = assessReadiness(config, stats.docCount);

  // Document status is committed as each batch reaches the vector store, so
  // it stays reliable after partial failures and process restarts.
  const docs = await readDocuments();
  const unindexedCount = docs.filter((document) => document.status !== 'indexed').length;

  return NextResponse.json({
    run,
    running: await isRunning(),
    docCount: stats.docCount,
    charCount: stats.charCount,
    ready,
    blockers,
    unindexedCount,
    config: {
      embeddingModelId: config.embeddingModelId,
      vectorStore: config.vectorStore,
      indexType: config.indexType,
      chunking: config.chunking,
    },
  });
}

export async function POST(req: Request) {
  if (await isRunning()) {
    return NextResponse.json({ error: 'An indexing run is already in progress.' }, { status: 409 });
  }

  const [config, stats] = await Promise.all([readConfig(), corpusStats()]);
  const { ready, blockers } = assessReadiness(config, stats.docCount);
  if (!ready) {
    return NextResponse.json(
      { error: blockers.join(' ') || 'Indexing is not ready.', blockers },
      { status: 400 },
    );
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {}

  const previousRun = await readRun();
  // A failed run can have a durable partial index. Its retry must continue the
  // visible unindexed queue instead of resetting successfully stored vectors.
  const incremental = body.incremental === true && Boolean(previousRun);

  const run = await createRun(config);
  void runIndexer(run.id, config, incremental ? previousRun : null);

  return NextResponse.json({ run }, { status: 202 });
}

export async function DELETE() {
  const { readRun, patchRun } = await import('@larkup/core/index-store');
  const run = await readRun();
  if (run && ['chunking', 'embedding', 'upserting'].includes(run.status)) {
    await patchRun({
      status: 'failed',
      error: 'Cancelled by user.',
      finishedAt: new Date().toISOString(),
    });
  }
  return NextResponse.json({ success: true });
}
