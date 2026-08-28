import { createAdapter } from '@larkup/vector-stores/factory';
import type { VectorRecord } from '@larkup/vector-stores/adapter';
import type { VectorStoreConfig } from '@larkup/vector-stores/types';
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
 * only for query-time text-to-video cross-modal search, which calls
 * DashScope's multimodal-embedding API directly (a plain HTTPS call, no
 * self-hosted weights, no GPU container), not the RAG embedding provider.
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

async function embedQueryTextForVideo(query: string): Promise<number[] | undefined> {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) return undefined;
  const baseUrl = process.env.LARKUP_VIDEO_DASHSCOPE_BASE_URL || DASHSCOPE_DEFAULT_URL;
  const model = process.env.LARKUP_VIDEO_EMBEDDING_MODEL || 'qwen3-vl-embedding';
  try {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        input: { contents: [{ text: query }] },
        parameters: { enable_fusion: false },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { output?: { embeddings?: Array<{ embedding?: number[] }> } };
    const vector = body.output?.embeddings?.[0]?.embedding;
    return Array.isArray(vector) ? vector : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Cross-modal search: free-text query -> nearest clip embeddings for this
 * asset. Returns nothing (not an error) when DASHSCOPE_API_KEY is unset or
 * the query embedding call fails, so a missing/unavailable video-embedding
 * tier degrades to the existing transcript/OCR/caption retrieval rather
 * than breaking the chat turn.
 */
export async function queryVideoEmbeddings(
  mediaAssetId: string,
  query: string,
  topK = 8,
): Promise<VideoEmbeddingHit[]> {
  if (!query.trim()) return [];
  const vector = await embedQueryTextForVideo(query);
  if (!vector) return [];
  const config = await readConfig();
  const adapter = await createAdapter(videoEmbeddingStoreConfig(config));
  const hits = await adapter.query(vector, topK * 4, query);
  return hits
    .filter((hit) => hit.metadata?.mediaAssetId === mediaAssetId)
    .slice(0, topK)
    .map((hit) => ({
      clipId: String(hit.metadata?.clipId ?? ''),
      startSecs: Number(hit.metadata?.startSecs ?? 0),
      endSecs: Number(hit.metadata?.endSecs ?? 0),
      score: hit.score,
    }));
}
