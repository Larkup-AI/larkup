import type { IndexType, VectorStoreDescriptor, VectorStoreId } from "@larkup-rag/core/types"

/**
 * Declarative registry of supported vector stores.
 *
 * This single object powers two very different consumers:
 *  1. The Configuration form — renders `fields` dynamically so each store
 *     asks for *exactly* the credentials/config it needs.
 *  2. The Phase 4 dependency resolver — reads `serverDependencies` so the
 *     GENERATED server only ships the deps for the selected store
 *     (pick Pinecone => no LanceDB in the output package.json).
 *
 * Adding a new store later = adding one entry here. No UI changes needed.
 */
export const VECTOR_STORES: Record<VectorStoreId, VectorStoreDescriptor> = {
  lancedb: {
    id: "lancedb",
    label: "LanceDB",
    description:
      "Embedded, file-based vector DB. Runs fully local for dev or against LanceDB Cloud for production.",
    runtime: "both",
    docsUrl: "https://lancedb.github.io/lancedb/",
    serverDependencies: {
      "@lancedb/lancedb": "^0.21.0",
    },
    fields: [
      {
        key: "mode",
        label: "Mode",
        type: "select",
        required: true,
        defaultValue: "local",
        help: "Local writes to disk on the toolkit host. Cloud connects to LanceDB Cloud.",
        options: [
          { label: "Local (on-disk)", value: "local" },
          { label: "Cloud", value: "cloud" },
        ],
      },
      {
        key: "dbPath",
        label: "Database path",
        type: "path",
        required: true,
        placeholder: "./.ragtoolkit/lancedb",
        help: "Directory where the LanceDB tables are stored.",
        showWhen: { key: "mode", equals: ["local"] },
      },
      {
        key: "uri",
        label: "Cloud URI",
        type: "text",
        required: true,
        placeholder: "db://my-database",
        help: "Your LanceDB Cloud database URI.",
        showWhen: { key: "mode", equals: ["cloud"] },
      },
      {
        key: "apiKey",
        label: "API key",
        type: "password",
        required: true,
        secret: true,
        placeholder: "sk_...",
        help: "LanceDB Cloud API key. Stored as an env var in the generated server.",
        showWhen: { key: "mode", equals: ["cloud"] },
      },
      {
        key: "tableName",
        label: "Table name",
        type: "text",
        required: true,
        defaultValue: "documents",
        help: "The table that holds your embedded chunks.",
      },
    ],
  },

  pinecone: {
    id: "pinecone",
    label: "Pinecone",
    description:
      "Fully-managed cloud vector database. Cloud-only — requires an API key and an existing index.",
    runtime: "cloud",
    docsUrl: "https://docs.pinecone.io/",
    serverDependencies: {
      "@pinecone-database/pinecone": "^6.0.0",
    },
    fields: [
      {
        key: "apiKey",
        label: "API key",
        type: "password",
        required: true,
        secret: true,
        placeholder: "pcsk_...",
        help: "Pinecone API key. Stored as an env var in the generated server.",
      },
      {
        key: "indexName",
        label: "Index name",
        type: "text",
        required: true,
        placeholder: "rag-index",
        help: "Name of the Pinecone index to upsert into / query. For hybrid/lexical mode this index must use the 'dotproduct' metric.",
      },
      {
        key: "namespace",
        label: "Namespace",
        type: "text",
        required: false,
        placeholder: "default",
        help: "Optional namespace to isolate this dataset within the index.",
      },
      {
        key: "sparseModel",
        label: "Sparse model",
        type: "text",
        required: true,
        defaultValue: "pinecone-sparse-english-v0",
        help: "Pinecone-hosted sparse model used to generate keyword vectors via the Inference API. Both dense and sparse vectors are stored in the same index.",
        showWhenIndexType: ["lexical", "hybrid"],
      },
    ],
  },

  weaviate: {
    id: "weaviate",
    label: "Weaviate",
    description:
      "Open-source AI-native vector database with built-in hybrid search, BM25, and multi-tenancy.",
    runtime: "both",
    docsUrl: "https://weaviate.io/developers/weaviate",
    serverDependencies: {
      weaviate: "^3.0.0",
    },
    fields: [
      {
        key: "host",
        label: "Host URL",
        type: "text",
        required: true,
        placeholder: "https://my-cluster.weaviate.network",
        help: "Weaviate Cloud URL or self-hosted host address.",
      },
      {
        key: "apiKey",
        label: "API key",
        type: "password",
        required: false,
        secret: true,
        placeholder: "weaviate-api-key",
        help: "Weaviate Cloud API key (optional for self-hosted).",
      },
      {
        key: "className",
        label: "Collection name",
        type: "text",
        required: true,
        defaultValue: "Documents",
        help: "The Weaviate collection (class) that holds your embedded chunks.",
      },
    ],
  },

  qdrant: {
    id: "qdrant",
    label: "Qdrant",
    description:
      "High-performance vector search engine with rich filtering, built for production-scale RAG.",
    runtime: "both",
    docsUrl: "https://qdrant.tech/documentation/",
    serverDependencies: {
      "@qdrant/js-client-rest": "^1.9.0",
    },
    fields: [
      {
        key: "url",
        label: "Host URL",
        type: "text",
        required: true,
        placeholder: "http://localhost:6333",
        help: "Qdrant server URL (local or Qdrant Cloud endpoint).",
      },
      {
        key: "apiKey",
        label: "API key",
        type: "password",
        required: false,
        secret: true,
        placeholder: "qdrant-api-key",
        help: "Qdrant Cloud API key (leave blank for local).",
      },
      {
        key: "collectionName",
        label: "Collection name",
        type: "text",
        required: true,
        defaultValue: "documents",
        help: "Qdrant collection to upsert into and query.",
      },
    ],
  },

  chroma: {
    id: "chroma",
    label: "Chroma",
    description:
      "Open-source, developer-friendly embedding database. Great for rapid local prototyping.",
    runtime: "both",
    docsUrl: "https://docs.trychroma.com/",
    serverDependencies: {
      chromadb: "^1.9.0",
    },
    fields: [
      {
        key: "host",
        label: "Host URL",
        type: "text",
        required: true,
        placeholder: "http://localhost:8000",
        defaultValue: "http://localhost:8000",
        help: "Chroma server URL (local Docker or remote).",
      },
      {
        key: "collectionName",
        label: "Collection name",
        type: "text",
        required: true,
        defaultValue: "documents",
        help: "Chroma collection to store and retrieve embeddings.",
      },
      {
        key: "authToken",
        label: "Auth token",
        type: "password",
        required: false,
        secret: true,
        placeholder: "chroma-token",
        help: "Optional static auth token for Chroma server.",
      },
    ],
  },

  pgvector: {
    id: "pgvector",
    label: "pgvector",
    description:
      "PostgreSQL extension for vector similarity search. Self-host vectors alongside your relational data.",
    runtime: "both",
    docsUrl: "https://github.com/pgvector/pgvector",
    serverDependencies: {
      pg: "^8.11.0",
      pgvector: "^0.2.0",
    },
    fields: [
      {
        key: "connectionString",
        label: "Connection string",
        type: "password",
        required: true,
        secret: true,
        placeholder: "postgresql://user:pass@localhost:5432/db",
        help: "Full PostgreSQL connection string.",
      },
      {
        key: "tableName",
        label: "Table name",
        type: "text",
        required: true,
        defaultValue: "embeddings",
        help: "The table used to store vector embeddings. Created automatically if absent.",
      },
    ],
  },

  supabase: {
    id: "supabase",
    label: "Supabase",
    description:
      "Postgres-backed vector store via the pgvector extension with Supabase's managed infrastructure.",
    runtime: "cloud",
    docsUrl: "https://supabase.com/docs/guides/ai",
    serverDependencies: {
      "@supabase/supabase-js": "^2.43.0",
    },
    fields: [
      {
        key: "url",
        label: "Project URL",
        type: "text",
        required: true,
        placeholder: "https://xyz.supabase.co",
        help: "Your Supabase project URL.",
      },
      {
        key: "serviceKey",
        label: "Service role key",
        type: "password",
        required: true,
        secret: true,
        placeholder: "eyJhbGci...",
        help: "Supabase service_role key (not the anon key). Stored as an env var.",
      },
      {
        key: "tableName",
        label: "Table name",
        type: "text",
        required: true,
        defaultValue: "documents",
        help: "Supabase table with a vector column for embeddings.",
      },
    ],
  },
}

export const VECTOR_STORE_LIST: VectorStoreDescriptor[] =
  Object.values(VECTOR_STORES)

export function getVectorStore(id: VectorStoreId): VectorStoreDescriptor {
  return VECTOR_STORES[id]
}

/**
 * Returns the fields that should currently be visible for a store given the
 * values already entered (handles `showWhen` dependencies like LanceDB
 * local-vs-cloud) and the current `indexType` (handles `showWhenIndexType`
 * for Pinecone sparse model).
 */
export function visibleFields(
  store: VectorStoreDescriptor,
  values: Record<string, string>,
  indexType?: IndexType,
) {
  return store.fields.filter((field) => {
    // Sibling-field dependency (e.g. LanceDB mode → local/cloud fields)
    if (field.showWhen) {
      const current = values[field.showWhen.key] ?? ""
      if (!field.showWhen.equals.includes(current)) return false
    }
    // Cross-concern dependency (e.g. indexType → sparse model)
    if (field.showWhenIndexType && indexType) {
      if (!field.showWhenIndexType.includes(indexType)) return false
    }
    return true
  })
}

/**
 * Validates store config against the registry. Returns a map of
 * field key -> error message for any missing required (visible) field.
 */
export function validateStoreConfig(
  store: VectorStoreDescriptor,
  values: Record<string, string>,
  indexType?: IndexType,
): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const field of visibleFields(store, values, indexType)) {
    if (field.required && !values[field.key]?.trim()) {
      errors[field.key] = `${field.label} is required`
    }
  }
  return errors
}
