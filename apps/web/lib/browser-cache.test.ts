import { describe, expect, it, vi } from 'vitest';
import {
  clearRecentAddHistory,
  MEDIA_RECENT_URLS_STORAGE_KEY,
  RECENT_ADD_HISTORY_CLEARED_EVENT,
  SCRAPE_RECENT_QUERIES_STORAGE_KEY,
} from './browser-cache';

describe('clearRecentAddHistory', () => {
  it('removes website and media history without clearing unrelated browser settings', () => {
    const removeItem = vi.fn();

    clearRecentAddHistory({ removeItem });

    expect(removeItem.mock.calls).toEqual([
      [SCRAPE_RECENT_QUERIES_STORAGE_KEY],
      [MEDIA_RECENT_URLS_STORAGE_KEY],
    ]);
    expect(removeItem).not.toHaveBeenCalledWith('app-theme');
    expect(removeItem).not.toHaveBeenCalledWith('larkup-server-api-key');
  });

  it('notifies mounted Add-page panels after clearing the stored values', () => {
    const dispatchEvent = vi.fn();

    clearRecentAddHistory({ removeItem: vi.fn() }, { dispatchEvent });

    expect(dispatchEvent).toHaveBeenCalledOnce();
    expect(dispatchEvent.mock.calls[0][0]).toBeInstanceOf(Event);
    expect(dispatchEvent.mock.calls[0][0].type).toBe(RECENT_ADD_HISTORY_CLEARED_EVENT);
  });
});
