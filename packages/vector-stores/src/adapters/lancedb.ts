import path from 'node:path';
import fs from 'node:fs/promises';
import * as lancedb from '@lancedb/lancedb';
import type { QueryHit, VectorRecord, VectorStoreAdapter } from './base';

/**
 * LanceDB adapter — embedded/on-disk for local dev, or LanceDB Cloud.
 *
 * The table schema is inferred from the first batch of rows we add, so `init`
 * is a no-op connect; the table is (re)created lazily on `reset`/first upsert.
 */

interface LanceConfig {
  mode?: string;
  dbPath?: string;
  uri?: string;
  apiKey?: string;
  tableName?: string;
}

interface LanceRow extends Record<string, unknown> {
  id: string;
  vector: number[];
  text: string;
  title: string;
  url: string;
  source: string;
  documentId: string;
  chunkIndex: number;
  metadata?: string;
}

export class LanceDBAdapter implements VectorStoreAdapter {
  private conn: lancedb.Connection | null = null;
  private table: lancedb.Table | null = null;
  private readonly tableName: string;

  constructor(private readonly config: LanceConfig) {
    this.tableName = config.tableName?.trim() || 'documents';
  }

  private async connect(): Promise<lancedb.Connection> {
    if (this.conn) return this.conn;
    if (this.config.mode === 'cloud') {
      if (!this.config.uri || !this.config.apiKey) {
        throw new Error('LanceDB Cloud requires both a URI and an API key.');
      }
      if (!this.config.uri.startsWith('db://')) {
        throw new Error("LanceDB Cloud URI must start with 'db://' (e.g. db://my-database).");
      }
      this.conn = await lancedb.connect(this.config.uri, {
        apiKey: this.config.apiKey,
      });
    } else {
      const dir = this.config.dbPath?.trim() || './.larkup/lancedb';
      let abs = path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir);

      try {
        await fs.mkdir(abs, { recursive: true });
      } catch (err: any) {
        if (path.isAbsolute(dir)) {
          const fallbackDir = '.' + dir;
          abs = path.join(process.cwd(), fallbackDir);
          try {
            await fs.mkdir(abs, { recursive: true });
          } catch (fallbackErr: any) {
            throw new Error(
              `Could not create directory for LanceDB at "${abs}": ${fallbackErr.message}`,
            );
          }
        } else {
          throw new Error(`Could not create directory for LanceDB at "${abs}": ${err.message}`);
        }
      }

      this.conn = await lancedb.connect(abs);
    }
    return this.conn;
  }

  async init(): Promise<void> {
    const conn = await this.connect();
    const names = await conn.tableNames();
    if (names.includes(this.tableName)) {
      this.table = await conn.openTable(this.tableName);
    }
  }

  async reset(): Promise<void> {
    const conn = await this.connect();
    const names = await conn.tableNames();
    if (names.includes(this.tableName)) {
      await conn.dropTable(this.tableName);
    }
    this.table = null;
  }

  async deleteByDocumentIds(documentIds: string[]): Promise<void> {
    if (documentIds.length === 0) return;
    if (!this.table) {
      await this.init();
      if (!this.table) return;
    }
    const idsString = documentIds.map((id) => `'${id}'`).join(', ');
    await this.table.delete(`documentId IN (${idsString})`);
  }

  private toRow(r: VectorRecord): LanceRow {
    return {
      id: r.id,
      vector: r.vector,
      text: r.text,
      title: r.title,
      url: r.url ?? '',
      source: r.source,
      documentId: r.documentId,
      chunkIndex: r.chunkIndex,
      metadata: r.metadata ? JSON.stringify(r.metadata) : undefined,
    };
  }

  async upsert(records: VectorRecord[]): Promise<void> {
    if (records.length === 0) return;
    const conn = await this.connect();
    const rows = records.map((r) => this.toRow(r));

    if (!this.table) {
      const names = await conn.tableNames();
      if (names.includes(this.tableName)) {
        this.table = await conn.openTable(this.tableName);
        await this.table.add(rows);
      } else {
        // First batch defines the schema (incl. vector dimensions).
        this.table = await conn.createTable(this.tableName, rows);
      }
    } else {
      await this.table.add(rows);
    }
  }

  async count(): Promise<number | null> {
    if (!this.table) {
      await this.init();
      if (!this.table) return 0;
    }
    try {
      return await this.table.countRows();
    } catch {
      return null;
    }
  }

  async query(vector: number[], topK: number): Promise<QueryHit[]> {
    if (!this.table) {
      await this.init();
      if (!this.table) return [];
    }
    const rows = (await this.table.search(vector).limit(topK).toArray()) as Array<
      LanceRow & { _distance?: number }
    >;

    return rows.map((row) => ({
      id: row.id as string,
      score: typeof row._distance === 'number' ? 1 / (1 + row._distance) : 0,
      text: row.text as string,
      title: row.title as string,
      url: (row.url as string) || undefined,
      documentId: row.documentId as string,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : undefined,
    }));
  }

  async testConnection(dimensions: number): Promise<void> {
    if (this.config.mode !== 'cloud') {
      try {
        await this.connect();
        return;
      } catch (err: any) {
        throw new Error(`Failed to connect to local LanceDB: ${err.message}`);
      }
    }

    // ── Cloud mode ───────────────────────────────────────────────────────────
    // to force a real authenticated HTTP round-trip.
    let conn: lancedb.Connection;
    try {
      conn = await this.connect();
    } catch (err: any) {
      throw new Error(`Failed to connect to LanceDB Cloud: ${err.message}`);
    }

    try {
      await conn.tableNames();
    } catch (err: any) {
      const msg: string = err.message ?? '';

      // property). Pattern: "Http error: ... 401 Unauthorized: Unauthorized"
      if (
        msg.includes('401') ||
        msg.includes('Unauthorized') ||
        msg.includes('403') ||
        msg.includes('Forbidden')
      ) {
        throw new Error(
          'Invalid LanceDB Cloud API key. Please check your credentials in the LanceDB Cloud dashboard.',
        );
      }

      if (msg.includes('404') || msg.includes('Not Found')) {
        throw new Error(
          `LanceDB Cloud database not found. Please verify your URI (e.g. "db://my-database").`,
        );
      }

      throw new Error(`Failed to reach LanceDB Cloud: ${msg}`);
    }
  }
}
