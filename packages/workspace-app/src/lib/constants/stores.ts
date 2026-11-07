export type StoreMeta = { iconSrc: string; pillBg: string };

export const STORE_META: Record<string, StoreMeta> = {
  lancedb: {
    iconSrc: '/icons/lancedb2.png',
    pillBg: 'bg-yellow-50 dark:bg-yellow-950/40',
  },
  pinecone: {
    iconSrc: '/icons/pinecone.png',
    pillBg: 'bg-green-50 dark:bg-green-950/40',
  },
  weaviate: { iconSrc: '/icons/weaviate.webp', pillBg: 'bg-green-50 dark:bg-green-950/40' },
  qdrant: { iconSrc: '/icons/qdrant.svg', pillBg: 'bg-red-50 dark:bg-red-950/40' },
  chroma: { iconSrc: '/icons/chroma.png', pillBg: 'bg-orange-50 dark:bg-orange-950/40' },
  pgvector: { iconSrc: '/icons/pgvector2.png', pillBg: 'bg-blue-50 dark:bg-blue-950/40' },
  supabase: { iconSrc: '/icons/supabase.png', pillBg: 'bg-green-50 dark:bg-green-950/40' },
};
