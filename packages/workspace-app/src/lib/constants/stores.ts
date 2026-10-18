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
};
