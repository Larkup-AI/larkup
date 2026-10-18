export const SCRAPE_RECENT_QUERIES_STORAGE_KEY = 'scrape_recent_queries';
export const MEDIA_RECENT_URLS_STORAGE_KEY = 'media_recent_urls';
export const RECENT_ADD_HISTORY_CLEARED_EVENT = 'larkup:recent-add-history-cleared';

export const RECENT_ADD_HISTORY_STORAGE_KEYS = [
  SCRAPE_RECENT_QUERIES_STORAGE_KEY,
  MEDIA_RECENT_URLS_STORAGE_KEY,
] as const;

/** Clear disposable Add-page history and notify panels already mounted in this browser tab. */
export function clearRecentAddHistory(
  storage: Pick<Storage, 'removeItem'>,
  eventTarget?: Pick<EventTarget, 'dispatchEvent'>,
) {
  for (const key of RECENT_ADD_HISTORY_STORAGE_KEYS) storage.removeItem(key);
  eventTarget?.dispatchEvent(new Event(RECENT_ADD_HISTORY_CLEARED_EVENT));
}
