import type { IndexType, VectorStoreDescriptor, VectorStoreId } from "@buddy-rag/core/types"

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
