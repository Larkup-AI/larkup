import { createAdapter } from '@larkup/vector-stores/factory';
import type { VectorRecord } from '@larkup/vector-stores/adapter';
import type { VectorStoreConfig } from '@larkup/vector-stores/types';
import { trackUsageEvent } from '../analytics-store';
import { readConfig } from '../config-store';

/**
 * A second vector-store table/collection for Qwen3-VL-Embedding clip
 * vectors, built on the exact same adapter abstraction as the main text
 * corpus (createAdapter -- no Pinecone-specific or any other
 * vendor-specific code here). It has to be a *separate* collection rather
 * than mixed into the main one: this embedding space has a different
 * dimensionality than the configured text embedding model, and most vector
 * stores require one fixed dimensionality per collection.
 * VectorStoreAdapter.upsert() already accepts a precomputed `vector`
 * directly, so this never calls the text embedder for the clip side --
 * only for query-time text-to-video cross-modal search, which calls the same
 * multimodal provider/model family that created the stored clip vectors.
 */

const COLLECTION_KEYS = ['tableName', 'collectionName', 'indexName'] as const;

function videoEmbeddingStoreConfig(base: VectorStoreConfig): VectorStoreConfig {
  const storeConfig = { ...base.storeConfig };
  for (const key of COLLECTION_KEYS) {
    if (storeConfig[key]) storeConfig[key] = `${storeConfig[key]}-video`;
  }
  return { ...base, storeConfig };
}

export interface VideoClipEmbeddingInput {
  clipId: string;
  startSecs: number;
  endSecs: number;
  vector: number[];
  provider: string;
}

export async function upsertVideoEmbeddings(
  mediaAssetId: string,
  knowledgeRevisionId: string,
  embeddings: VideoClipEmbeddingInput[],
): Promise<void> {
  if (embeddings.length === 0) return;
  const config = await readConfig();
  const adapter = await createAdapter(videoEmbeddingStoreConfig(config));
  await adapter.init(embeddings[0].vector.length);
  const records: VectorRecord[] = embeddings.map((embedding) => ({
    id: `${mediaAssetId}:${embedding.clipId}`,
    vector: embedding.vector,
    text: `${embedding.startSecs.toFixed(1)}s-${embedding.endSecs.toFixed(1)}s`,
    title: `${mediaAssetId} clip ${embedding.clipId}`,
    source: 'video-embedding',
    documentId: `video-embedding:${mediaAssetId}:${embedding.clipId}`,
    chunkIndex: 0,
    metadata: {
      mediaAssetId,
      knowledgeRevisionId,
      clipId: embedding.clipId,
      startSecs: embedding.startSecs,
      endSecs: embedding.endSecs,
      provider: embedding.provider,
    },
  }));
  await adapter.upsert(records);
}

export async function deleteVideoEmbeddings(documentIds: string[]): Promise<void> {
  if (documentIds.length === 0) return;
  const config = await readConfig();
  const adapter = await createAdapter(videoEmbeddingStoreConfig(config));
  await adapter.deleteByDocumentIds(documentIds);
}

export interface VideoEmbeddingHit {
  clipId: string;
  startSecs: number;
  endSecs: number;
  score: number;
}

const DASHSCOPE_DEFAULT_URL =
  'https://dashscope-intl.aliyuncs.com/api/v1/services/embeddings/multimodal-embedding/multimodal-embedding';
const GATEWAY_DEFAULT_URL = 'https://ai-gateway.vercel.sh/v4/ai';

type QueryEmbeddingProvider =
  | 'gateway-gemini-embedding-2'
  | 'huggingface-qwen3-vl-embedding'
  | 'qwen3-vl-embedding'
  | 'runpod-qwen3-vl-embedding';

interface QueryEmbedding {
  provider: QueryEmbeddingProvider;
  model: string;
  vector: number[];
}

function queryProviderOrder(): QueryEmbeddingProvider[] {
  const supported = new Set<QueryEmbeddingProvider>([
    'gateway-gemini-embedding-2',
    'huggingface-qwen3-vl-embedding',
    'qwen3-vl-embedding',
    'runpod-qwen3-vl-embedding',
  ]);
  const ordered: QueryEmbeddingProvider[] = [];
  const add = (provider?: string) => {
    const normalized = provider?.trim().toLowerCase() as QueryEmbeddingProvider | undefined;
    if (normalized && supported.has(normalized) && !ordered.includes(normalized)) {
      ordered.push(normalized);
    }
  };

  add(process.env.LARKUP_VIDEO_EMBEDDING_PROVIDER);
  add(process.env.LARKUP_VIDEO_EMBEDDING_FALLBACK_PROVIDER);
  if (process.env.AI_GATEWAY_API_KEY) add('gateway-gemini-embedding-2');
  if (process.env.DASHSCOPE_API_KEY) add('qwen3-vl-embedding');
  if (
    (process.env.LARKUP_VIDEO_HF_EMBEDDING_API_KEY || process.env.HF_TOKEN) &&
    process.env.LARKUP_VIDEO_HF_EMBEDDING_URL
  ) {
    add('huggingface-qwen3-vl-embedding');
  }
  if (
    (process.env.LARKUP_VIDEO_RUNPOD_EMBEDDING_API_KEY || process.env.RUNPOD_API_KEY) &&
    (process.env.LARKUP_VIDEO_RUNPOD_EMBEDDING_BASE_URL ||
      process.env.LARKUP_VIDEO_RUNPOD_EMBEDDING_ENDPOINT_ID)
  ) {
    add('runpod-qwen3-vl-embedding');
  }
  return ordered;
}

async function embedQueryTextForVideo(
  provider: QueryEmbeddingProvider,
  query: string,
): Promise<QueryEmbedding | undefined> {
  const dimensions = Number(process.env.LARKUP_VIDEO_EMBEDDING_DIMENSION || 0) || undefined;
  let url = '';
  let model = '';
  let headers: Record<string, string> = { 'Content-Type': 'application/json' };
  let body: unknown;

  if (provider === 'gateway-gemini-embedding-2') {
    const apiKey = process.env.AI_GATEWAY_API_KEY;
    if (!apiKey) return undefined;
    model = process.env.LARKUP_VIDEO_GATEWAY_EMBEDDING_MODEL || 'google/gemini-embedding-2';
    url = `${(process.env.LARKUP_VIDEO_GATEWAY_EMBEDDING_BASE_URL || GATEWAY_DEFAULT_URL).replace(
      /\/$/,
      '',
    )}/embedding-model`;
    headers = {
      ...headers,
      Authorization: `Bearer ${apiKey}`,
      'ai-gateway-protocol-version': '0.0.1',
      'ai-gateway-auth-method': 'api-key',
      'ai-embedding-model-specification-version': '4',
      'ai-model-id': model,
    };
    body = {
      values: [query],
      providerOptions: { google: { taskType: 'RETRIEVAL_QUERY' } },
    };
  } else if (provider === 'qwen3-vl-embedding') {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) return undefined;
    model = process.env.LARKUP_VIDEO_EMBEDDING_MODEL || 'qwen3-vl-embedding';
    url = process.env.LARKUP_VIDEO_DASHSCOPE_BASE_URL || DASHSCOPE_DEFAULT_URL;
    headers.Authorization = `Bearer ${apiKey}`;
    body = {
      model,
      input: { contents: [{ text: query }] },
      parameters: { enable_fusion: false, ...(dimensions ? { dimension: dimensions } : {}) },
    };
  } else if (provider === 'huggingface-qwen3-vl-embedding') {
    const apiKey = process.env.LARKUP_VIDEO_HF_EMBEDDING_API_KEY || process.env.HF_TOKEN;
    url = process.env.LARKUP_VIDEO_HF_EMBEDDING_URL || '';
    if (!apiKey || !url) return undefined;
    model = process.env.LARKUP_VIDEO_EMBEDDING_MODEL || 'qwen3-vl-embedding';
    headers.Authorization = `Bearer ${apiKey}`;
    body = { inputs: [{ text: query }], ...(dimensions ? { dimensions } : {}) };
  } else {
    const apiKey = process.env.LARKUP_VIDEO_RUNPOD_EMBEDDING_API_KEY || process.env.RUNPOD_API_KEY;
    const endpointId = process.env.LARKUP_VIDEO_RUNPOD_EMBEDDING_ENDPOINT_ID;
    url =
      process.env.LARKUP_VIDEO_RUNPOD_EMBEDDING_BASE_URL ||
      (endpointId ? `https://api.runpod.ai/v2/${endpointId}/runsync` : '');
    if (!apiKey || !url) return undefined;
    model = process.env.LARKUP_VIDEO_EMBEDDING_MODEL || 'qwen3-vl-embedding';
    headers.Authorization = `Bearer ${apiKey}`;
    body = { input: { inputs: [{ text: query }], ...(dimensions ? { dimensions } : {}) } };
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return undefined;
    const responseBody = (await response.json()) as {
      embeddings?: number[][];
      output?: { embeddings?: number[][] | Array<{ embedding?: number[] }> };
    };
    const raw = responseBody.embeddings?.[0] ?? responseBody.output?.embeddings?.[0];
    const vector = Array.isArray(raw) ? raw : raw?.embedding;
    if (!Array.isArray(vector)) return undefined;
    void trackUsageEvent({
      type: 'embedding',
      embeddingModelId: model,
      chunkCount: 1,
      timestamp: new Date().toISOString(),
    });
    return { provider, model, vector };
  } catch {
    return undefined;
  }
}

/**
 * Cross-modal search: free-text query -> nearest clip embeddings for this
 * asset. Each available provider is attempted in configured order and only
 * matches vectors produced by that same provider. Missing credentials,
 * endpoint failures, and old collections with another vector dimension all
 * degrade to transcript/OCR/caption retrieval rather than breaking chat.
 */
export async function queryVideoEmbeddings(
  mediaAssetId: string,
  query: string,
  topK = 8,
): Promise<VideoEmbeddingHit[]> {
  if (!query.trim()) return [];
  const config = await readConfig();
  const adapter = await createAdapter(videoEmbeddingStoreConfig(config));
  for (const provider of queryProviderOrder()) {
    const embedding = await embedQueryTextForVideo(provider, query);
    if (!embedding) continue;
    try {
      const hits = await adapter.query(embedding.vector, topK * 4, query);
      const matching = hits
        .filter(
          (hit) =>
            hit.metadata?.mediaAssetId === mediaAssetId &&
            (!hit.metadata?.provider || hit.metadata.provider === embedding.provider),
        )
        .slice(0, topK)
        .map((hit) => ({
          clipId: String(hit.metadata?.clipId ?? ''),
          startSecs: Number(hit.metadata?.startSecs ?? 0),
          endSecs: Number(hit.metadata?.endSecs ?? 0),
          score: hit.score,
        }));
      if (matching.length) return matching;
    } catch {
      // A collection created by an older provider can have another fixed
      // vector dimension. Continue to the next same-space query provider.
    }
  }
  return [];
}
