import { create } from 'zustand';
import type { CrawlScope, SearchResultItem } from '@larkup/core/types';

export interface SearchState {
  results: SearchResultItem[];
  totalResults: number;
  totalResultsIsEstimate: boolean;
  currentPage: number;
  totalPages: number;
  hasMore: boolean;
  query: string;
  searchProvider: 'firecrawl' | 'serper' | 'google' | 'brave' | 'bing' | 'tavily';
}

type StateUpdate<T> = T | ((previous: T) => T);

interface ScrapeStore {
  query: string;
  searchState: SearchState | null;
  selected: Record<string, boolean>;
  scope: CrawlScope;
  pageLimit: number;
  searchLimit: number;
  showAdvanced: boolean;
  serperTotalForQuery: { query: string; total: number; totalPages: number } | null;

  setQuery: (query: string) => void;
  setSearchState: (state: StateUpdate<SearchState | null>) => void;
  setSelected: (selected: StateUpdate<Record<string, boolean>>) => void;
  setScope: (scope: CrawlScope) => void;
  setPageLimit: (limit: number) => void;
  setSearchLimit: (limit: number) => void;
  setShowAdvanced: (show: boolean) => void;
  setSerperTotalForQuery: (
    value: StateUpdate<{ query: string; total: number; totalPages: number } | null>,
  ) => void;

  flush: () => void;
}

export const useScrapeStore = create<ScrapeStore>()((set) => ({
  query: '',
  searchState: null,
  selected: {},
  scope: 'domain',
  pageLimit: 25,
  searchLimit: 15,
  showAdvanced: false,
  serperTotalForQuery: null,

  setQuery: (query) => set({ query }),
  setSearchState: (state) =>
    set((prev) => ({
      searchState: typeof state === 'function' ? state(prev.searchState) : state,
    })),
  setSelected: (selected) =>
    set((prev) => ({
      selected: typeof selected === 'function' ? selected(prev.selected) : selected,
    })),
  setScope: (scope) => set({ scope }),
  setPageLimit: (limit) => set({ pageLimit: limit }),
  setSearchLimit: (limit) => set({ searchLimit: limit }),
  setShowAdvanced: (show) => set({ showAdvanced: show }),
  setSerperTotalForQuery: (value) =>
    set((prev) => ({
      serperTotalForQuery: typeof value === 'function' ? value(prev.serperTotalForQuery) : value,
    })),

  flush: () =>
    set({
      query: '',
      searchState: null,
      selected: {},
      serperTotalForQuery: null,
    }),
}));
