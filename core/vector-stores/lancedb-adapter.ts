import path from "node:path"
import * as lancedb from "@lancedb/lancedb"
import type {
  QueryHit,
  VectorRecord,
  VectorStoreAdapter,
} from "@/core/vector-stores/adapter"

/**
 * LanceDB adapter — embedded/on-disk for local dev, or LanceDB Cloud.
 *
 * The table schema is inferred from the first batch of rows we add, so `init`
 * is a no-op connect; the table is (re)created lazily on `reset`/first upsert.
 */

interface LanceConfig {
  mode?: string
  dbPath?: string
  uri?: string
  apiKey?: string
  tableName?: string
}

interface LanceRow extends Record<string, unknown> {
  id: string
  vector: number[]
  text: string
  title: string
  url: string
  source: string
  documentId: string
  chunkIndex: number
}

export class LanceDBAdapter implements VectorStoreAdapter {
  private conn: lancedb.Connection | null = null
  private table: lancedb.Table | null = null
  private readonly tableName: string

  constructor(private readonly config: LanceConfig) {
    this.tableName = config.tableName?.trim() || "documents"
  }

  private async connect(): Promise<lancedb.Connection> {
    if (this.conn) return this.conn
    if (this.config.mode === "cloud") {
      if (!this.config.uri || !this.config.apiKey) {
        throw new Error("LanceDB Cloud requires both a URI and an API key.")
      }
      this.conn = await lancedb.connect(this.config.uri, {
        apiKey: this.config.apiKey,
      })
    } else {
      const dir = this.config.dbPath?.trim() || "./.ragtoolkit/lancedb"
      const abs = path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir)
      this.conn = await lancedb.connect(abs)
    }
    return this.conn
  }

  async init(): Promise<void> {
    const conn = await this.connect()
    const names = await conn.tableNames()
    if (names.includes(this.tableName)) {
      this.table = await conn.openTable(this.tableName)
    }
  }

  async reset(): Promise<void> {
    const conn = await this.connect()
    const names = await conn.tableNames()
    if (names.includes(this.tableName)) {
      await conn.dropTable(this.tableName)
    }
    this.table = null
  }

  private toRow(r: VectorRecord): LanceRow {
    return {
      id: r.id,
      vector: r.vector,
      text: r.text,
      title: r.title,
      url: r.url ?? "",
      source: r.source,
      documentId: r.documentId,
      chunkIndex: r.chunkIndex,
    }
  }

  async upsert(records: VectorRecord[]): Promise<void> {
    if (records.length === 0) return
    const conn = await this.connect()
    const rows = records.map((r) => this.toRow(r))

    if (!this.table) {
      const names = await conn.tableNames()
      if (names.includes(this.tableName)) {
        this.table = await conn.openTable(this.tableName)
        await this.table.add(rows)
      } else {
        // First batch defines the schema (incl. vector dimensions).
        this.table = await conn.createTable(this.tableName, rows)
      }
    } else {
      await this.table.add(rows)
    }
  }

  async count(): Promise<number | null> {
    if (!this.table) {
      await this.init()
      if (!this.table) return 0
    }
    try {
      return await this.table.countRows()
    } catch {
      return null
    }
  }

  async query(vector: number[], topK: number): Promise<QueryHit[]> {
    if (!this.table) {
      await this.init()
      if (!this.table) return []
    }
    const rows = (await this.table
      .search(vector)
      .limit(topK)
      .toArray()) as Array<LanceRow & { _distance?: number }>

    return rows.map((row) => ({
      id: row.id,
      // Convert L2 distance → a 0..1 similarity-ish score for display.
      score: typeof row._distance === "number" ? 1 / (1 + row._distance) : 0,
      text: row.text,
      title: row.title,
      url: row.url || undefined,
      documentId: row.documentId,
    }))
  }
}
