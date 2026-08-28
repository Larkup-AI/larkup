export type VectorStoreId =
  | 'lancedb'
  | 'pinecone'
  | 'weaviate'
  | 'qdrant'
  | 'chroma'
  | 'pgvector'
  | 'supabase';

export type StoreRuntime = 'local' | 'cloud' | 'both';
export type FieldType = 'text' | 'password' | 'path' | 'select';
export type IndexType = 'lexical' | 'semantic' | 'hybrid';

export interface StoreFieldOption {
  label: string;
  value: string;
}

export interface StoreField {
  key: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  required: boolean;
  help?: string;
  options?: StoreFieldOption[];
  defaultValue?: string;
  showWhen?: { key: string; equals: string[] };
  showWhenIndexType?: IndexType[];
  secret?: boolean;
}

export interface VectorStoreDescriptor {
  id: VectorStoreId;
  label: string;
  description: string;
  runtime: StoreRuntime;
  installStatus: 'installed' | 'installable' | 'coming-soon';
  serverDependencies: Record<string, string>;
  fields: StoreField[];
  docsUrl?: string;
}

/** The vector-store settings required to create an adapter. */
export interface VectorStoreConfig {
  vectorStore: VectorStoreId;
  indexType: IndexType;
  storeConfig: Record<string, string>;
}
