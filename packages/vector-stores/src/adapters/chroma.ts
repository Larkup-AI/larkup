import type { QueryHit, VectorRecord, VectorStoreAdapter } from './base';

/** Chroma Cloud and self-hosted adapter. */

interface ChromaConfig {
  mode?: string;
  /** Server URL — used when mode is "server" */
  host?: string;
  /** Static auth token for server mode */
  authToken?: string;
  /** Cloud API key */
  apiKey?: string;
  /** Cloud tenant */
  tenant?: string;
  /** Cloud database */
  database?: string;
  /** Collection name */
  collectionName?: string;
  /** Search mode. */
  indexType?: string;
}

/** Reciprocal-rank-fusion constant. */
const RRF_K = 60;

export class ChromaAdapter implements VectorStoreAdapter {
  private client: any = null;
  private collection: any = null;
  private readonly collectionName: string;

  constructor(private readonly config: ChromaConfig) {
    this.collectionName = config.collectionName?.trim() || 'documents';
  }

  /** Lazily load the optional Chroma client. */
  private async getClient(): Promise<any> {
    if (this.client) return this.client;

    let chromadb: any;
    try {
      chromadb = await import('chromadb');
    } catch {
      throw new Error(
        'The "chromadb" package is not installed. Please install it first via the Configure page or run: pnpm add chromadb --filter @larkup/vector-stores',
      );
    }

    if (this.config.mode === 'cloud') {
      if (!this.config.apiKey) {
        throw new Error('Chroma Cloud requires an API key.');
      }
      const CloudClientClass = chromadb.CloudClient ?? chromadb.default?.CloudClient;
      if (!CloudClientClass) {
        throw new Error('Could not find CloudClient in the chromadb package.');
      }
      this.client = new CloudClientClass({
        apiKey: this.config.apiKey,
        tenant: this.config.tenant || 'default_tenant',
        database: this.config.database || 'default_database',
      });
    } else {
      // Server mode
      const host = this.config.host?.trim() || 'http://localhost:8000';
      const ClientClass = chromadb.ChromaClient ?? chromadb.default?.ChromaClient;
      if (!ClientClass) {
        throw new Error('Could not find ChromaClient in the chromadb package.');
      }
      const opts: any = { path: host };
      if (this.config.authToken) {
        opts.auth = {
          provider: 'token',
          credentials: this.config.authToken,
        };
      }
      this.client = new ClientClass(opts);
    }

    return this.client;
  }

  private async getCollection(): Promise<any> {
    if (this.collection) return this.collection;
    const client = await this.getClient();
    this.collection = await client.getOrCreateCollection({
      name: this.collectionName,
      metadata: { 'hnsw:space': 'cosine' },
    });
    return this.collection;
  }

  async init(_dimensions: number): Promise<void> {
    await this.getCollection();
  }

  async reset(): Promise<void> {
    const client = await this.getClient();
    try {
      await client.deleteCollection({ name: this.collectionName });
    } catch {
      /* collection may not exist yet — that's fine */
    }
    this.collection = null;
  }

  async deleteByDocumentIds(documentIds: string[]): Promise<void> {
    if (documentIds.length === 0) return;
    try {
      const collection = await this.getCollection();
      await collection.delete({ where: { documentId: { $in: documentIds } } });
    } catch (err) {
      console.error('Failed to delete vectors by documentIds in Chroma:', err);
    }
  }

  async upsert(records: VectorRecord[]): Promise<void> {
    if (records.length === 0) return;
    const collection = await this.getCollection();

    // Chroma expects parallel arrays.
    const ids: string[] = [];
    const embeddings: number[][] = [];
    const documents: string[] = [];
    const metadatas: Record<string, any>[] = [];

    for (const r of records) {
      ids.push(r.id);
      embeddings.push(r.vector);
      documents.push(r.text);
      metadatas.push(this.buildMetadata(r));
    }

    const BATCH = 4096;
    for (let i = 0; i < ids.length; i += BATCH) {
      await collection.upsert({
        ids: ids.slice(i, i + BATCH),
        embeddings: embeddings.slice(i, i + BATCH),
        documents: documents.slice(i, i + BATCH),
        metadatas: metadatas.slice(i, i + BATCH),
      });
    }
  }

  private buildMetadata(r: VectorRecord): Record<string, any> {
    const meta: Record<string, any> = {
      title: r.title,
      source: r.source,
      documentId: r.documentId,
      chunkIndex: r.chunkIndex,
    };
    if (r.url) meta.url = r.url;
    // Chroma metadata supports scalar values only.
    if (r.metadata) {
      for (const [k, v] of Object.entries(r.metadata)) {
        if (v === null || v === undefined) continue;
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
          meta[k] = v;
        } else {
          meta[k] = JSON.stringify(v);
        }
      }
    }
    return meta;
  }

  async count(): Promise<number | null> {
    try {
      const collection = await this.getCollection();
      return await collection.count();
    } catch {
      return null;
    }
  }

  async query(vector: number[], topK: number, queryText?: string): Promise<QueryHit[]> {
    const collection = await this.getCollection();
    const isSemantic = this.config.indexType === 'semantic';
    const isLexical = this.config.indexType === 'lexical';

    // Dense search.
    if (isSemantic || !queryText?.trim()) {
      return this.denseQuery(collection, vector, topK);
    }

    // Lexical full-text search.
    if (isLexical) {
      return this.documentQuery(collection, queryText, topK);
    }

    // Hybrid search.
    const denseHits = await this.denseQuery(collection, vector, topK);

    try {
      const textHits = await this.documentQuery(collection, queryText, topK);
      if (textHits.length > 0) {
        return rrfMerge(denseHits, textHits, topK);
      }
    } catch {
      // Fall back to dense results.
    }

    return denseHits;
  }

  private async denseQuery(collection: any, vector: number[], topK: number): Promise<QueryHit[]> {
    const result = await collection.query({
      queryEmbeddings: [vector],
      nResults: topK,
      include: ['documents', 'metadatas', 'distances'],
    });

    return this.parseQueryResult(result);
  }

  private async documentQuery(
    collection: any,
    queryText: string,
    topK: number,
  ): Promise<QueryHit[]> {
    const result = await collection.get({
      whereDocument: { $contains: queryText },
      limit: topK,
      include: ['documents', 'metadatas'],
    });

    return this.parseGetResult(result);
  }

  private parseGetResult(result: any): QueryHit[] {
    if (!result.ids || result.ids.length === 0) return [];

    const ids = result.ids as string[];
    const documents = result.documents ?? [];
    const metadatas = result.metadatas ?? [];

    return ids.map((id, i) => {
      const meta = (metadatas[i] ?? {}) as Record<string, any>;
      const score = 1.0; // Exact lexical matches get the maximum base score.

      const { title, url, source, documentId, chunkIndex, ...customMetadata } = meta;

      return {
        id,
        score,
        text: (documents[i] as string) ?? '',
        title: (title as string) ?? 'Untitled',
        url: (url as string) || undefined,
        documentId: (documentId as string) ?? '',
        metadata: Object.keys(customMetadata).length > 0 ? customMetadata : undefined,
      };
    });
  }

  private parseQueryResult(result: any): QueryHit[] {
    if (!result.ids?.[0]) return [];

    const ids = result.ids[0] as string[];
    const documents = result.documents?.[0] ?? [];
    const metadatas = result.metadatas?.[0] ?? [];
    const distances = result.distances?.[0] ?? [];

    return ids.map((id, i) => {
      const meta = (metadatas[i] ?? {}) as Record<string, any>;
      const distance = distances[i] ?? 0;
      // Convert distance to similarity.
      const score = 1 / (1 + distance);

      const { title, url, source, documentId, chunkIndex, ...customMetadata } = meta;

      return {
        id,
        score,
        text: (documents[i] as string) ?? '',
        title: (title as string) ?? 'Untitled',
        url: (url as string) || undefined,
        documentId: (documentId as string) ?? '',
        metadata: Object.keys(customMetadata).length > 0 ? customMetadata : undefined,
      };
    });
  }

  async testConnection(_dimensions: number): Promise<void> {
    let client: any;
    try {
      client = await this.getClient();
    } catch (err: any) {
      throw new Error(`Failed to connect to Chroma: ${err.message}`);
    }

    // heartbeat() is the lightest-weight RPC to verify connectivity
    try {
      await client.heartbeat();
    } catch (err: any) {
      const msg: string = err.message ?? '';

      if (
        msg.includes('401') ||
        msg.includes('Unauthorized') ||
        msg.includes('403') ||
        msg.includes('Forbidden')
      ) {
        throw new Error('Invalid Chroma credentials. Please check your auth token or API key.');
      }

      if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
        throw new Error(
          'Could not reach the Chroma server. Is it running and accessible at the configured URL?',
        );
      }

      throw new Error(`Failed to reach Chroma server: ${msg}`);
    }

    try {
      await client.listCollections();
    } catch (err: any) {
      throw new Error(
        `Connected to Chroma but failed to access the database or tenant. Please verify your tenant and database names. Error: ${err.message}`,
      );
    }
  }
}

// Result helpers.

function rrfMerge(denseHits: QueryHit[], sparseHits: QueryHit[], topK: number): QueryHit[] {
  const scores = new Map<string, { hit: QueryHit; score: number }>();

  const addList = (hits: QueryHit[]) =>
    hits.forEach((hit, rank) => {
      const contrib = 1 / (RRF_K + rank + 1);
      const prev = scores.get(hit.id);
      if (prev) {
        prev.score += contrib;
      } else {
        scores.set(hit.id, { hit, score: contrib });
      }
    });

  addList(denseHits);
  addList(sparseHits);

  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ hit, score }) => ({ ...hit, score }));
}
