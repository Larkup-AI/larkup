"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { formatErrorMessage } from "@/lib/error-formatter";
import {
  Globe,
  Loader2,
  Plus,
  Rocket,
  Search,
  ChevronDown,
  ChevronsDown,
  Info,
  Clock,
  X,
} from "lucide-react";
import type { CrawlScope, SearchResultItem } from "@larkup-rag/core/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";

import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { GenericAlert } from "@/components/alerts/generic-alert";
import { cn } from "@/lib/utils";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

function domainOf(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function formatCount(n: number): string {
  if (n >= 1_000_000_000) return `~${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `~${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `~${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString();
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `~${Math.ceil(seconds)}s`;
  if (seconds < 3600) return `~${Math.ceil(seconds / 60)}min`;
  const h = Math.floor(seconds / 3600);
  const m = Math.ceil((seconds % 3600) / 60);
  return `~${h}h ${m}min`;
}

/** Estimate ETL duration based on URL count, scope, and page limit */
function estimateEtlDuration(
  urlCount: number,
  scope: CrawlScope,
  pageLimit: number,
): { totalPages: number; estimatedSeconds: number } {
  // ~3s per page scrape, ~5s per domain page (crawl overhead)
  const pagesPerUrl = scope === "domain" ? pageLimit : 1;
  const totalPages = urlCount * pagesPerUrl;
  const perPageSeconds = scope === "domain" ? 5 : 3;
  const estimatedSeconds = totalPages * perPageSeconds;
  return { totalPages, estimatedSeconds };
}

interface SearchState {
  results: SearchResultItem[];
  totalResults: number;
  totalResultsIsEstimate: boolean;
  currentPage: number;
  totalPages: number;
  hasMore: boolean;
  query: string;
  searchProvider: "firecrawl" | "serper";
}

export function ScrapePanel({
  disabled,
  onStarted,
}: {
  disabled: boolean;
  onStarted: () => void;
}) {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [gatheringAll, setGatheringAll] = useState(false);
  const [gatherProgress, setGatherProgress] = useState(0);
  const [searchState, setSearchState] = useState<SearchState | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [scope, setScope] = useState<CrawlScope>("domain");
  const [pageLimit, setPageLimit] = useState(25);
  const [manualUrl, setManualUrl] = useState("");
  const [starting, setStarting] = useState(false);
  /** When true: only the exact custom URLs are scraped — no deep crawl/pagination */
  const [specificUrls, setSpecificUrls] = useState(false);
  const [serperConfigured, setSerperConfigured] = useState<boolean | null>(
    null,
  );
  const [firecrawlConfigured, setFirecrawlConfigured] = useState<
    boolean | null
  >(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [fetchingCount, setFetchingCount] = useState(false);
  const [serperTotalForQuery, setSerperTotalForQuery] = useState<{
    query: string;
    total: number;
    totalPages: number;
  } | null>(null);
  const [cachedQueries, setCachedQueries] = useState<string[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [searchLimit, setSearchLimit] = useState(15);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        inputRef.current &&
        !inputRef.current.contains(event.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("scrape_recent_queries");
      if (saved) setCachedQueries(JSON.parse(saved));
    } catch {
      // ignore
    }
  }, []);

  function saveQuery(q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;
    setCachedQueries((prev) => {
      const newCache = [
        trimmed,
        ...prev.filter((item) => item !== trimmed),
      ].slice(0, 10);
      try {
        localStorage.setItem("scrape_recent_queries", JSON.stringify(newCache));
      } catch {
        // ignore
      }
      return newCache;
    });
  }

  function removeQuery(q: string, e: React.MouseEvent) {
    e.stopPropagation();
    setCachedQueries((prev) => {
      const newCache = prev.filter((item) => item !== q);
      try {
        localStorage.setItem("scrape_recent_queries", JSON.stringify(newCache));
      } catch {
        // ignore
      }
      return newCache;
    });
  }

  // Check providers on mount
  useEffect(() => {
    // Check Serper
    fetch("/api/search/google")
      .then((r) => r.json())
      .then((d) => setSerperConfigured(d.configured ?? false))
      .catch(() => setSerperConfigured(false));
    // Check Firecrawl
    fetch("/api/search")
      .then((r) => r.json())
      .then((d) => setFirecrawlConfigured(d.configured ?? false))
      .catch(() => setFirecrawlConfigured(false));
  }, []);

  const selectedUrls = useMemo(
    () => Object.keys(selected).filter((u) => selected[u]),
    [selected],
  );

  /** Search using Firecrawl (preferred — no Serper credits used for search). */
  async function searchFirecrawl(q: string, isMulti: boolean) {
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, limit: searchLimit }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Search failed");
      const newItems = (data.results as SearchResultItem[]) ?? [];

      setSearchState((prev) => {
        const existingResults = prev ? prev.results : [];
        const existingUrls = new Set(existingResults.map((r) => r.url));
        const fresh = newItems.filter((r) => !existingUrls.has(r.url));
        return {
          results: [...existingResults, ...fresh],
          totalResults: isMulti
            ? (prev?.totalResults ?? 0) + fresh.length
            : fresh.length,
          totalResultsIsEstimate: false,
          currentPage: 1,
          totalPages: 1,
          hasMore: false,
          query: isMulti ? "Multiple queries" : q,
          searchProvider: "firecrawl",
        };
      });

      const newSelected = Object.fromEntries(newItems.map((r) => [r.url, true]));
      setSelected((prev) => ({ ...prev, ...newSelected }));

      if (newItems.length === 0 && !isMulti)
        toast.message("No results — try different keywords.");

      // If Serper is also configured, fetch the total count in background
      if (serperConfigured && !isMulti) {
        fetchSerperTotalCount(q);
      }
    } catch (err) {
      toast.error(formatErrorMessage(err));
    }
  }

  /** Search using Serper (fallback if Firecrawl not available). */
  async function searchSerper(
    q: string,
    page: number,
    isMulti: boolean,
    appendPagination = false,
  ) {
    if (!appendPagination) {
      // It's the initial search, searching flag is handled in runSearch
    } else {
      setLoadingMore(true);
    }

    try {
      const res = await fetch("/api/search/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, page }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error ?? "Search failed");

      const newItems: SearchResultItem[] = (data.items ?? []).map(
        (item: { url: string; title: string; description?: string }) => ({
          url: item.url,
          title: item.title || item.url,
          description: item.description,
        }),
      );

      setSearchState((prev) => {
        const existingResults = prev ? prev.results : [];
        const existingUrls = new Set(existingResults.map((r) => r.url));
        const fresh = newItems.filter((r) => !existingUrls.has(r.url));
        return {
          results: [...existingResults, ...fresh],
          totalResults: (prev?.totalResults ?? 0) + (data.totalResults ?? 0),
          totalResultsIsEstimate: data.totalResultsIsEstimate ?? true,
          currentPage: data.currentPage ?? page,
          totalPages: data.totalPages ?? 1,
          hasMore: data.hasMore ?? false,
          query: data.query ?? q,
          searchProvider: "serper",
        };
      });

      const newSelected = Object.fromEntries(newItems.map((r) => [r.url, true]));
      setSelected((prev) => ({ ...prev, ...newSelected }));

      if (!isMulti) {
        // Update Serper total
        setSerperTotalForQuery({
          query: q,
          total: data.totalResults ?? 0,
          totalPages: data.totalPages ?? 1,
        });
      }

      if (page === 1 && (data.totalResults ?? 0) === 0 && !isMulti) {
        toast.message("No results — try different keywords.");
      }
    } catch (err) {
      toast.error(formatErrorMessage(err));
    } finally {
      if (appendPagination) setLoadingMore(false);
    }
  }

  /** Fetch total count from Serper without using it for results (saves on Firecrawl credits) */
  async function fetchSerperTotalCount(q: string) {
    setFetchingCount(true);
    try {
      const res = await fetch("/api/search/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, page: 1 }),
      });
      const data = await res.json();
      if (res.ok) {
        setSerperTotalForQuery({
          query: q,
          total: data.totalResults ?? 0,
          totalPages: data.totalPages ?? 1,
        });
      }
    } catch {
      // Silent fail — count is optional
    } finally {
      setFetchingCount(false);
    }
  }

  async function runSearch() {
    setShowDropdown(false);
    if (!query.trim()) {
      toast.error("Enter one or more keywords to search.");
      return;
    }

    // We do NOT clear selected URLs here so users can keep them across searches
    setSerperTotalForQuery(null);
    saveQuery(query);

    const queries = query
      .split(",")
      .map((q) => q.trim())
      .filter(Boolean);
    if (queries.length === 0) return;

    setSearching(true);
    // Removed setSearchState(null) so we append instead of clear

    try {
      if (firecrawlConfigured) {
        await Promise.all(
          queries.map((q) => searchFirecrawl(q, queries.length > 1)),
        );
      } else if (serperConfigured) {
        await Promise.all(
          queries.map((q) => searchSerper(q, 1, queries.length > 1, false)),
        );
      } else {
        toast.error(
          formatErrorMessage(
            new Error(
              "No search provider available. Configure Firecrawl or add SERPER_API_KEY.",
            ),
          ),
        );
      }
    } finally {
      setSearching(false);
    }
  }

  async function loadNextPage() {
    if (!searchState?.hasMore || loadingMore) return;
    if (searchState.searchProvider === "serper") {
      await searchSerper(
        searchState.query,
        searchState.currentPage + 1,
        false,
        true,
      );
    }
  }

  /** Automatically paginate through ALL available Serper results. */
  async function gatherAll() {
    if (!searchState || searchState.searchProvider !== "serper") return;
    setGatheringAll(true);
    setGatherProgress(searchState.currentPage);

    let page = searchState.currentPage + 1;
    const total = searchState.totalPages;

    try {
      while (page <= total) {
        setGatherProgress(page);
        const res = await fetch("/api/search/google", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: query.trim(), page }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Search failed");

        const newItems: SearchResultItem[] = (data.items ?? []).map(
          (item: { url: string; title: string; description?: string }) => ({
            url: item.url,
            title: item.title || item.url,
            description: item.description,
          }),
        );

        setSearchState((prev) => {
          if (!prev) return prev;
          const existingUrls = new Set(prev.results.map((r) => r.url));
          const fresh = newItems.filter((r) => !existingUrls.has(r.url));
          return {
            ...prev,
            results: [...prev.results, ...fresh],
            totalResultsIsEstimate:
              data.totalResultsIsEstimate ?? prev.totalResultsIsEstimate,
            currentPage: data.currentPage ?? page,
            totalPages: data.totalPages ?? prev.totalPages,
            hasMore: data.hasMore ?? false,
          };
        });

        const newSelected = Object.fromEntries(newItems.map((r) => [r.url, true]));
        setSelected((prev) => ({ ...prev, ...newSelected }));

        if (!data.hasMore) break;
        page++;
        await new Promise((r) => setTimeout(r, 300));
      }
      toast.success("All available results gathered!");
    } catch (err) {
      toast.error(formatErrorMessage(err));
    } finally {
      setGatheringAll(false);
      setGatherProgress(0);
    }
  }

  function addManual() {
    const urls = manualUrl
      .split(/[\s,]+/)
      .map((u) => u.trim())
      .filter((u) => /^https?:\/\//i.test(u));

    if (urls.length === 0) {
      toast.error("Enter at least one full URL starting with http(s)://");
      return;
    }

    const items: SearchResultItem[] = urls.map((url) => ({
      url,
      title: url,
    }));

    setSearchState((prev) => {
      const existingUrls = new Set(prev?.results.map((r) => r.url) ?? []);
      const newItems = items.filter((item) => !existingUrls.has(item.url));
      const combined = [...newItems, ...(prev?.results ?? [])];

      return prev
        ? {
            ...prev,
            results: combined,
            totalResults: prev.totalResults + newItems.length,
          }
        : {
            results: combined,
            totalResults: combined.length,
            totalResultsIsEstimate: false,
            currentPage: 1,
            totalPages: 1,
            hasMore: false,
            query: "",
            searchProvider: "firecrawl",
          };
    });

    const newSelected = Object.fromEntries(urls.map((u) => [u, true]));
    setSelected((prev) => ({ ...prev, ...newSelected }));
    setManualUrl("");
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (text) {
        setManualUrl((prev) => prev + (prev ? "\n" : "") + text);
      }
    };
    reader.readAsText(file);
    e.target.value = ""; // reset input
  };

  /** Open confirm modal before starting ETL */
  function handleStartClick() {
    if (selectedUrls.length === 0) {
      toast.error("Select at least one URL to scrape.");
      return;
    }
    setConfirmOpen(true);
  }

  async function startJob() {
    setStarting(true);
    setConfirmOpen(false);
    // When "Specific URLs" is on, force page-level scrape (no crawl)
    const effectiveScope: CrawlScope = specificUrls ? "page" : scope;
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keywords: query || selectedUrls[0],
          pageLimit: specificUrls ? 1 : pageLimit,
          targets: selectedUrls.map((url) => ({ url, scope: effectiveScope })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not start job");

      const { totalPages, estimatedSeconds } = estimateEtlDuration(
        selectedUrls.length,
        effectiveScope,
        specificUrls ? 1 : pageLimit,
      );

      toast.success("ETL job started — running in background", {
        description: specificUrls
          ? `Scraping ${selectedUrls.length} specific URL(s) only — no deep crawl. You can navigate away — progress is tracked automatically.`
          : `${selectedUrls.length} ${effectiveScope === "domain" ? "domain(s)" : "page(s)"} · ~${totalPages} pages · ETA ${formatDuration(estimatedSeconds)}. You can navigate away — progress is tracked automatically.`,
        duration: 8000,
      });

      setSelected({});
      onStarted();
    } catch (err) {
      toast.error(formatErrorMessage(err));
    } finally {
      setStarting(false);
    }
  }

  const results = searchState?.results ?? [];
  const gatherAllAvailable =
    searchState?.searchProvider === "serper" &&
    searchState.hasMore &&
    !gatheringAll;

  // Estimate for confirmation modal
  const effectiveScopeForEstimate: CrawlScope = specificUrls ? "page" : scope;
  const estimate = useMemo(
    () =>
      estimateEtlDuration(
        selectedUrls.length,
        effectiveScopeForEstimate,
        specificUrls ? 1 : pageLimit,
      ),
    [selectedUrls.length, effectiveScopeForEstimate, specificUrls, pageLimit],
  );

  const [inputMode, setInputMode] = useState<"search" | "url">("search");

  return (
    <div className="space-y-4">
      {/* Unified input area */}
      <div className="space-y-3">
        {/* Mode toggle + input */}
        <div className="flex items-center gap-2">
          <Tabs
            value={inputMode}
            onValueChange={(v) => setInputMode(v as "search" | "url")}
            className="shrink-0"
          >
            <TabsList className="inline-flex h-9 items-center justify-center rounded-lg bg-muted/40 border border-border p-0.5 text-muted-foreground">
              <TabsTrigger
                value="search"
                className="inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-xs font-medium transition-all focus-visible:outline-none data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm hover:text-foreground h-full"
              >
                <Search className="size-3.5 mr-1.5" />
                Search
              </TabsTrigger>
              <TabsTrigger
                value="url"
                className="inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-xs font-medium transition-all focus-visible:outline-none data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm hover:text-foreground h-full"
              >
                <Globe className="size-3.5 mr-1.5" />
                Direct URL
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Input field */}
          <div className="relative flex-1">
            {inputMode === "search" ? (
              <>
                <Input
                  ref={inputRef}
                  id="kw"
                  placeholder='Search keywords, e.g. "RAG pipelines"'
                  value={query}
                  disabled={disabled}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setShowDropdown(true);
                  }}
                  onFocus={() => setShowDropdown(true)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      setShowDropdown(false);
                      runSearch();
                    }
                  }}
                />
                {showDropdown && cachedQueries.length > 0 && (
                  <div
                    ref={dropdownRef}
                    className="absolute z-10 top-full left-0 mt-1 w-full rounded-md border border-border bg-popover shadow-md overflow-hidden"
                  >
                    <div className="py-1">
                      {cachedQueries.map((cq) => (
                        <div
                          key={cq}
                          className="flex items-center justify-between px-3 py-1.5 text-sm hover:bg-muted cursor-pointer group"
                          onClick={() => {
                            setQuery(cq);
                            setShowDropdown(false);
                          }}
                        >
                          <div className="flex items-center gap-2 truncate mr-2">
                            <Clock className="size-3 text-muted-foreground shrink-0" />
                            <span className="truncate text-xs">{cq}</span>
                          </div>
                          <button
                            className="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity p-0.5"
                            onClick={(e) => removeQuery(cq, e)}
                          >
                            <X className="size-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <Input
                placeholder="Paste URLs (comma or space separated)"
                value={manualUrl}
                disabled={disabled}
                onChange={(e) => setManualUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addManual()}
              />
            )}
          </div>

          {/* Search limit (only in search mode) */}
          {inputMode === "search" && (
            <Input
              type="number"
              min={1}
              max={100}
              value={searchLimit}
              disabled={disabled || searching}
              onChange={(e) => setSearchLimit(Number(e.target.value) || 15)}
              title="Max results"
              className="w-20 shrink-0 tabular-nums"
            />
          )}

          {/* Action button */}
          {inputMode === "search" ? (
            <Button
              onClick={() => {
                setShowDropdown(false);
                runSearch();
              }}
              disabled={disabled || searching}
              className="shrink-0"
            >
              {searching ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Search className="size-4" />
              )}
              Search
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={addManual}
              disabled={disabled}
              className="shrink-0"
            >
              <Plus className="size-4" />
              Add
            </Button>
          )}
        </div>
      </div>

      {/* No provider configured hint */}
      {firecrawlConfigured === false && serperConfigured === false && (
        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span>
            <strong className="text-foreground">
              No search provider configured.
            </strong>{" "}
            Set up Firecrawl (recommended) for search and scraping, or add{" "}
            <code className="rounded bg-muted px-1 font-mono">
              SERPER_API_KEY
            </code>{" "}
            to your{" "}
            <code className="rounded bg-muted px-1 font-mono">.env</code> for
            Google search.
          </span>
        </div>
      )}

      {/* Scope + launch — compact single row */}
      <div className="flex items-center gap-3 flex-wrap">
        <Select
          defaultValue={scope}
          value={scope}
          onValueChange={(v) => setScope(v as CrawlScope)}
          disabled={specificUrls || disabled}
        >
          <SelectTrigger className="w-auto min-w-[180px] flex-1 bg-white h-9 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="page">Scrape pages only</SelectItem>
            <SelectItem value="domain">Crawl whole domain</SelectItem>
          </SelectContent>
        </Select>

        {scope === "domain" && !specificUrls && (
          <div className="flex items-center gap-1.5">
            <Label
              htmlFor="limit"
              className="text-xs text-muted-foreground whitespace-nowrap"
            >
              Max pages
            </Label>
            <Input
              id="limit"
              type="number"
              min={1}
              max={500}
              value={pageLimit}
              disabled={specificUrls || disabled}
              onChange={(e) => setPageLimit(Number(e.target.value) || 1)}
              className="w-20 h-9 tabular-nums"
            />
          </div>
        )}

        <div className="flex items-center gap-1.5">
          <Switch
            id="specific-urls-inline"
            checked={specificUrls}
            onCheckedChange={setSpecificUrls}
            disabled={disabled}
            size="sm"
          />
          <Label
            htmlFor="specific-urls-inline"
            className="text-xs font-medium cursor-pointer flex items-center gap-1"
          >
            Exact URLs
            <TooltipProvider delay={0}>
              <Tooltip>
                <TooltipTrigger
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={(e) => e.preventDefault()}
                >
                  <Info className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-[200px] text-center">
                    Scrape exact URLs only — no deep crawl or pagination.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </Label>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          {/* ETL estimation inline */}
          {selectedUrls.length > 0 && (
            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Clock className="size-3" />
              {specificUrls
                ? `${selectedUrls.length} URL${selectedUrls.length !== 1 ? "s" : ""}`
                : `~${estimate.totalPages.toLocaleString()} pages · ${formatDuration(estimate.estimatedSeconds)}`}
            </span>
          )}

          <Button
            onClick={handleStartClick}
            disabled={disabled || starting || selectedUrls.length === 0}
            className="shrink-0"
          >
            {starting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Rocket className="size-4" />
            )}
            Start ETL
            {selectedUrls.length > 0 && (
              <Badge variant="secondary" className="ml-1">
                {selectedUrls.length}
              </Badge>
            )}
          </Button>
        </div>
      </div>

      {/* Results list */}
      {results.length > 0 && (
        <div className="rounded-lg border border-border">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">
              {results.length} source{results.length === 1 ? "" : "s"} ·{" "}
              {selectedUrls.length} selected
            </span>
            <button
              type="button"
              className="text-xs text-primary hover:underline"
              onClick={() => {
                const all = selectedUrls.length !== results.length;
                setSelected(
                  all
                    ? Object.fromEntries(results.map((r) => [r.url, true]))
                    : {},
                );
              }}
            >
              {selectedUrls.length === results.length
                ? "Clear all"
                : "Select all"}
            </button>
          </div>
          <ul className="max-h-72 divide-y divide-border overflow-y-auto">
            {results.map((r) => {
              const checked = !!selected[r.url];
              return (
                <li key={r.url}>
                  <label
                    className={cn(
                      "flex cursor-pointer items-start gap-3 px-3 py-2.5 transition-colors hover:bg-muted/50",
                      checked && "bg-accent/50",
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) =>
                        setSelected((prev) => ({ ...prev, [r.url]: !!v }))
                      }
                      className="mt-0.5"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {r.title}
                      </span>
                      <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                        <Globe className="size-3 shrink-0" />
                        {domainOf(r.url)}
                      </span>
                      {r.description && (
                        <span className="mt-0.5 line-clamp-1 block text-xs text-muted-foreground/80">
                          {r.description}
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>

          {/* Pagination footer */}
          {searchState?.searchProvider === "serper" &&
            (searchState.hasMore || loadingMore || gatheringAll) && (
              <div className="flex items-center justify-between border-t border-border px-3 py-2">
                <span className="text-xs text-muted-foreground">
                  {gatheringAll
                    ? `Gathering page ${gatherProgress} of ${searchState.totalPages}…`
                    : `Page ${searchState.currentPage} of ${searchState.totalPages}`}
                </span>
                <div className="flex items-center gap-2">
                  {gatherAllAvailable && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1 text-xs"
                      onClick={gatherAll}
                    >
                      <ChevronsDown className="size-3.5" />
                      Gather all (
                      {searchState.totalPages - searchState.currentPage} more
                      pages)
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 text-xs"
                    onClick={loadNextPage}
                    disabled={
                      !searchState?.hasMore || loadingMore || gatheringAll
                    }
                  >
                    {loadingMore ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <ChevronDown className="size-3.5" />
                    )}
                    Load next page
                  </Button>
                </div>
              </div>
            )}
        </div>
      )}

      {/* Confirmation modal */}
      <GenericAlert
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Start ETL Job?"
        description={
          specificUrls
            ? `This will scrape ${selectedUrls.length} specific URL${selectedUrls.length !== 1 ? "s" : ""} exactly as provided — no deep crawl or pagination.\n\nThe job will run in the background. You can navigate away and check progress anytime.`
            : `This will scrape ${selectedUrls.length} ${scope === "domain" ? "domain(s)" : "page(s)"}${scope === "domain" ? ` with up to ${pageLimit} pages each` : ""}.\n\n• Total pages: ~${estimate.totalPages.toLocaleString()}\n• Estimated time: ${formatDuration(estimate.estimatedSeconds)}\n\nThe job will run in the background. You can navigate away and check progress anytime.`
        }
        actionText="Start ETL Job"
        onAction={startJob}
      />
    </div>
  );
}
