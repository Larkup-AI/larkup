"use client"

import { useMemo, useState, useEffect, useCallback, useRef } from "react"
import { toast } from "sonner"
import {
  Globe,
  Loader2,
  Plus,
  Rocket,
  Search,
  ChevronDown,
  ChevronsDown,
  Info,
  CheckCheck,
  BarChart2,
  Clock,
  AlertTriangle,
  X,
} from "lucide-react"
import type { CrawlScope, SearchResultItem } from "@buddy-rag/core/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ConfirmModal } from "@/components/ui/confirm-modal"
import { cn } from "@/lib/utils"

function domainOf(url: string) {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function formatCount(n: number): string {
  if (n >= 1_000_000_000) return `~${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `~${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `~${(n / 1_000).toFixed(0)}K`
  return n.toLocaleString()
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `~${Math.ceil(seconds)}s`
  if (seconds < 3600) return `~${Math.ceil(seconds / 60)}min`
  const h = Math.floor(seconds / 3600)
  const m = Math.ceil((seconds % 3600) / 60)
  return `~${h}h ${m}min`
}

/** Estimate ETL duration based on URL count, scope, and page limit */
function estimateEtlDuration(
  urlCount: number,
  scope: CrawlScope,
  pageLimit: number,
): { totalPages: number; estimatedSeconds: number } {
  // ~3s per page scrape, ~5s per domain page (crawl overhead)
  const pagesPerUrl = scope === "domain" ? pageLimit : 1
  const totalPages = urlCount * pagesPerUrl
  const perPageSeconds = scope === "domain" ? 5 : 3
  const estimatedSeconds = totalPages * perPageSeconds
  return { totalPages, estimatedSeconds }
}

interface SearchState {
  results: SearchResultItem[]
  totalResults: number
  totalResultsIsEstimate: boolean
  currentPage: number
  totalPages: number
  hasMore: boolean
  query: string
  searchProvider: "firecrawl" | "serper"
}

export function ScrapePanel({
  disabled,
  onStarted,
}: {
  disabled: boolean
  onStarted: () => void
}) {
  const [query, setQuery] = useState("")
  const [searching, setSearching] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [gatheringAll, setGatheringAll] = useState(false)
  const [gatherProgress, setGatherProgress] = useState(0)
  const [searchState, setSearchState] = useState<SearchState | null>(null)
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [scope, setScope] = useState<CrawlScope>("domain")
  const [pageLimit, setPageLimit] = useState(25)
  const [manualUrl, setManualUrl] = useState("")
  const [starting, setStarting] = useState(false)
  const [serperConfigured, setSerperConfigured] = useState<boolean | null>(null)
  const [firecrawlConfigured, setFirecrawlConfigured] = useState<boolean | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [fetchingCount, setFetchingCount] = useState(false)
  const [serperTotalForQuery, setSerperTotalForQuery] = useState<{
    query: string
    total: number
    totalPages: number
  } | null>(null)
  const [cachedQueries, setCachedQueries] = useState<string[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        inputRef.current && !inputRef.current.contains(event.target as Node) &&
        dropdownRef.current && !dropdownRef.current.contains(event.target as Node)
      ) {
        setShowDropdown(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  useEffect(() => {
    try {
      const saved = localStorage.getItem("scrape_recent_queries")
      if (saved) setCachedQueries(JSON.parse(saved))
    } catch {
      // ignore
    }
  }, [])

  function saveQuery(q: string) {
    const trimmed = q.trim()
    if (!trimmed) return
    setCachedQueries((prev) => {
      const newCache = [trimmed, ...prev.filter((item) => item !== trimmed)].slice(0, 10)
      try {
        localStorage.setItem("scrape_recent_queries", JSON.stringify(newCache))
      } catch {
        // ignore
      }
      return newCache
    })
  }

  function removeQuery(q: string, e: React.MouseEvent) {
    e.stopPropagation()
    setCachedQueries((prev) => {
      const newCache = prev.filter((item) => item !== q)
      try {
        localStorage.setItem("scrape_recent_queries", JSON.stringify(newCache))
      } catch {
        // ignore
      }
      return newCache
    })
  }

  // Check providers on mount
  useEffect(() => {
    // Check Serper
    fetch("/api/search/google")
      .then((r) => r.json())
      .then((d) => setSerperConfigured(d.configured ?? false))
      .catch(() => setSerperConfigured(false))
    // Check Firecrawl
    fetch("/api/search")
      .then((r) => r.json())
      .then((d) => setFirecrawlConfigured(d.configured ?? false))
      .catch(() => setFirecrawlConfigured(false))
  }, [])

  const selectedUrls = useMemo(
    () => Object.keys(selected).filter((u) => selected[u]),
    [selected],
  )

  /** Search using Firecrawl (preferred — no Serper credits used for search). */
  async function searchFirecrawl(q: string, isMulti: boolean) {
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, limit: 15 }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Search failed")
      const newItems = (data.results as SearchResultItem[]) ?? []
      
      setSearchState((prev) => {
        const existingResults = prev ? prev.results : []
        const existingUrls = new Set(existingResults.map((r) => r.url))
        const fresh = newItems.filter((r) => !existingUrls.has(r.url))
        return {
          results: [...existingResults, ...fresh],
          totalResults: isMulti ? (prev?.totalResults ?? 0) + fresh.length : fresh.length,
          totalResultsIsEstimate: false,
          currentPage: 1,
          totalPages: 1,
          hasMore: false,
          query: isMulti ? "Multiple queries" : q,
          searchProvider: "firecrawl",
        }
      })
      if (newItems.length === 0 && !isMulti) toast.message("No results — try different keywords.")

      // If Serper is also configured, fetch the total count in background
      if (serperConfigured && !isMulti) {
        fetchSerperTotalCount(q)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Search failed for "${q}"`)
    }
  }

  /** Search using Serper (fallback if Firecrawl not available). */
  async function searchSerper(q: string, page: number, isMulti: boolean, appendPagination = false) {
    if (!appendPagination) {
      // It's the initial search, searching flag is handled in runSearch
    } else {
      setLoadingMore(true)
    }

    try {
      const res = await fetch("/api/search/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, page }),
      })
      const data = await res.json()

      if (!res.ok) throw new Error(data.error ?? "Search failed")

      const newItems: SearchResultItem[] = (data.items ?? []).map(
        (item: { url: string; title: string; description?: string }) => ({
          url: item.url,
          title: item.title || item.url,
          description: item.description,
        }),
      )

      setSearchState((prev) => {
        const existingResults = appendPagination || isMulti ? (prev ? prev.results : []) : []
        const existingUrls = new Set(existingResults.map((r) => r.url))
        const fresh = newItems.filter((r) => !existingUrls.has(r.url))
        return {
          results: [...existingResults, ...fresh],
          totalResults: isMulti ? (prev?.totalResults ?? 0) + (data.totalResults ?? 0) : (data.totalResults ?? 0),
          totalResultsIsEstimate: data.totalResultsIsEstimate ?? true,
          currentPage: data.currentPage ?? page,
          totalPages: isMulti ? 1 : (data.totalPages ?? 1),
          hasMore: isMulti ? false : (data.hasMore ?? false),
          query: isMulti ? "Multiple queries" : (data.query ?? q),
          searchProvider: "serper",
        }
      })

      if (!isMulti) {
        // Update Serper total
        setSerperTotalForQuery({
          query: q,
          total: data.totalResults ?? 0,
          totalPages: data.totalPages ?? 1,
        })
      }

      if (page === 1 && (data.totalResults ?? 0) === 0 && !isMulti) {
        toast.message("No results — try different keywords.")
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Search failed for "${q}"`)
    } finally {
      if (appendPagination) setLoadingMore(false)
    }
  }

  /** Fetch total count from Serper without using it for results (saves on Firecrawl credits) */
  async function fetchSerperTotalCount(q: string) {
    setFetchingCount(true)
    try {
      const res = await fetch("/api/search/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, page: 1 }),
      })
      const data = await res.json()
      if (res.ok) {
        setSerperTotalForQuery({
          query: q,
          total: data.totalResults ?? 0,
          totalPages: data.totalPages ?? 1,
        })
      }
    } catch {
      // Silent fail — count is optional
    } finally {
      setFetchingCount(false)
    }
  }

  async function runSearch() {
    setShowDropdown(false)
    if (!query.trim()) {
      toast.error("Enter one or more keywords to search.")
      return
    }
    
    // We do NOT clear selected URLs here so users can keep them across searches
    setSerperTotalForQuery(null)
    saveQuery(query)

    const queries = query.split(",").map(q => q.trim()).filter(Boolean)
    if (queries.length === 0) return

    setSearching(true)
    setSearchState(null) // Reset list before fetching new ones

    try {
      if (firecrawlConfigured) {
        await Promise.all(queries.map(q => searchFirecrawl(q, queries.length > 1)))
      } else if (serperConfigured) {
        await Promise.all(queries.map(q => searchSerper(q, 1, queries.length > 1, false)))
      } else {
        toast.error("No search provider available. Configure Firecrawl or add SERPER_API_KEY.")
      }
    } finally {
      setSearching(false)
    }
  }

  async function loadNextPage() {
    if (!searchState?.hasMore || loadingMore) return
    if (searchState.searchProvider === "serper") {
      await searchSerper(searchState.query, searchState.currentPage + 1, false, true)
    }
  }

  /** Automatically paginate through ALL available Serper results. */
  async function gatherAll() {
    if (!searchState || searchState.searchProvider !== "serper") return
    setGatheringAll(true)
    setGatherProgress(searchState.currentPage)

    let page = searchState.currentPage + 1
    const total = searchState.totalPages

    try {
      while (page <= total) {
        setGatherProgress(page)
        const res = await fetch("/api/search/google", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: query.trim(), page }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? "Search failed")

        const newItems: SearchResultItem[] = (data.items ?? []).map(
          (item: { url: string; title: string; description?: string }) => ({
            url: item.url,
            title: item.title || item.url,
            description: item.description,
          }),
        )

        setSearchState((prev) => {
          if (!prev) return prev
          const existingUrls = new Set(prev.results.map((r) => r.url))
          const fresh = newItems.filter((r) => !existingUrls.has(r.url))
          return {
            ...prev,
            results: [...prev.results, ...fresh],
            totalResultsIsEstimate: data.totalResultsIsEstimate ?? prev.totalResultsIsEstimate,
            currentPage: data.currentPage ?? page,
            totalPages: data.totalPages ?? prev.totalPages,
            hasMore: data.hasMore ?? false,
          }
        })

        if (!data.hasMore) break
        page++
        await new Promise((r) => setTimeout(r, 300))
      }
      toast.success("All available results gathered!")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to gather all results")
    } finally {
      setGatheringAll(false)
      setGatherProgress(0)
    }
  }

  function addManual() {
    if (!/^https?:\/\//i.test(manualUrl)) {
      toast.error("Enter a full URL starting with http(s)://")
      return
    }
    const item: SearchResultItem = { url: manualUrl, title: domainOf(manualUrl) }
    setSearchState((prev) =>
      prev
        ? {
            ...prev,
            results: prev.results.some((r) => r.url === item.url)
              ? prev.results
              : [item, ...prev.results],
          }
        : {
            results: [item],
            totalResults: 1,
            totalResultsIsEstimate: false,
            currentPage: 1,
            totalPages: 1,
            hasMore: false,
            query: "",
            searchProvider: "firecrawl",
          },
    )
    setSelected((prev) => ({ ...prev, [manualUrl]: true }))
    setManualUrl("")
  }

  /** Open confirm modal before starting ETL */
  function handleStartClick() {
    if (selectedUrls.length === 0) {
      toast.error("Select at least one URL to scrape.")
      return
    }
    setConfirmOpen(true)
  }

  async function startJob() {
    setStarting(true)
    setConfirmOpen(false)
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keywords: query || selectedUrls[0],
          pageLimit,
          targets: selectedUrls.map((url) => ({ url, scope })),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Could not start job")

      const { totalPages, estimatedSeconds } = estimateEtlDuration(
        selectedUrls.length,
        scope,
        pageLimit,
      )

      toast.success("ETL job started — running in background", {
        description: `${selectedUrls.length} ${scope === "domain" ? "domain(s)" : "page(s)"} · ~${totalPages} pages · ETA ${formatDuration(estimatedSeconds)}. You can navigate away — progress is tracked automatically.`,
        duration: 8000,
      })

      setSelected({})
      onStarted()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start job")
    } finally {
      setStarting(false)
    }
  }

  const results = searchState?.results ?? []
  const gatherAllAvailable =
    searchState?.searchProvider === "serper" && searchState.hasMore && !gatheringAll

  // Estimate for confirmation modal
  const estimate = useMemo(
    () => estimateEtlDuration(selectedUrls.length, scope, pageLimit),
    [selectedUrls.length, scope, pageLimit],
  )

  return (
    <div className="space-y-5">
      {/* Search bar */}
      <div className="space-y-2">
        <Label htmlFor="kw">Keywords / Organization</Label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              ref={inputRef}
              id="kw"
              placeholder='e.g. "TUHH university Hamburg"'
              value={query}
              disabled={disabled}
              onChange={(e) => {
                setQuery(e.target.value)
                setShowDropdown(true)
              }}
              onFocus={() => setShowDropdown(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setShowDropdown(false)
                  runSearch()
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
                      className="flex items-center justify-between px-3 py-2 text-sm hover:bg-muted cursor-pointer group"
                      onClick={() => {
                        setQuery(cq)
                        setShowDropdown(false)
                      }}
                    >
                      <div className="flex items-center gap-2 truncate mr-2">
                        <Clock className="size-3.5 text-muted-foreground shrink-0" />
                        <span className="truncate">{cq}</span>
                      </div>
                      <button
                        className="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity p-1"
                        onClick={(e) => removeQuery(cq, e)}
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <Button 
            onClick={() => {
              setShowDropdown(false)
              runSearch()
            }} 
            disabled={disabled || searching}
          >
            {searching ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Search className="size-4" />
            )}
            Search
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {firecrawlConfigured
            ? serperConfigured
              ? "Using Firecrawl for search + Serper for total result count. Scraping powered by Firecrawl."
              : "Using Firecrawl for search and scraping. Add SERPER_API_KEY for total result counts."
            : serperConfigured
              ? "Using Serper.dev for search. Set up Firecrawl for scraping."
              : "No search provider configured. Set up Firecrawl or add SERPER_API_KEY."}
        </p>
      </div>

      {/* Total count banner */}
      {searchState && searchState.totalResults > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
          <BarChart2 className="size-5 shrink-0 text-primary" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">
              <span className="text-primary">{results.length}</span> URLs loaded
              {searchState.searchProvider === "serper" && searchState.hasMore && (
                <span className="text-muted-foreground font-normal"> · more pages available</span>
              )}
            </p>
            {/* Show Serper total if available */}
            {serperTotalForQuery && serperTotalForQuery.query === searchState.query && (
              <p className="text-xs text-muted-foreground mt-0.5">
                Google has{" "}
                <span className="font-medium text-foreground">
                  {formatCount(serperTotalForQuery.total)}
                </span>{" "}
                results for <span className="italic">&quot;{searchState.query}&quot;</span>
                {" · "}accessible: up to {serperTotalForQuery.totalPages * 10} URLs
              </p>
            )}
            {fetchingCount && (
              <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                <Loader2 className="size-3 animate-spin" />
                Fetching total result count from Google…
              </p>
            )}
            {searchState.searchProvider === "serper" && (
              <p className="text-xs text-muted-foreground mt-0.5">
                Page {searchState.currentPage}
                {!searchState.totalResultsIsEstimate && ` of ${searchState.totalPages}`}{" "}
                · {results.length} URLs loaded
              </p>
            )}
          </div>
          {/* Gather-all progress */}
          {gatheringAll && (
            <div className="flex items-center gap-2 text-xs text-primary shrink-0">
              <Loader2 className="size-3.5 animate-spin" />
              Page {gatherProgress}/{searchState.totalPages}
            </div>
          )}
          {/* Gather all button */}
          {gatherAllAvailable && (
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 gap-1.5"
              onClick={gatherAll}
            >
              <ChevronsDown className="size-3.5" />
              Gather all
            </Button>
          )}
          {/* Done indicator */}
          {searchState.searchProvider === "serper" && !searchState.hasMore && !gatheringAll && searchState.totalPages > 1 && (
            <Badge variant="secondary" className="gap-1 shrink-0">
              <CheckCheck className="size-3" />
              All loaded
            </Badge>
          )}
        </div>
      )}

      {/* Manual URL input */}
      <div className="flex gap-2">
        <Input
          placeholder="…or paste a URL directly (https://…)"
          value={manualUrl}
          disabled={disabled}
          onChange={(e) => setManualUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addManual()}
        />
        <Button variant="outline" onClick={addManual} disabled={disabled}>
          <Plus className="size-4" />
          Add URL
        </Button>
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
                const all = selectedUrls.length !== results.length
                setSelected(
                  all
                    ? Object.fromEntries(results.map((r) => [r.url, true]))
                    : {},
                )
              }}
            >
              {selectedUrls.length === results.length ? "Clear all" : "Select all"}
            </button>
          </div>
          <ul className="max-h-72 divide-y divide-border overflow-y-auto">
            {results.map((r) => {
              const checked = !!selected[r.url]
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
              )
            })}
          </ul>

          {/* Pagination footer */}
          {searchState?.searchProvider === "serper" && (searchState.hasMore || loadingMore || gatheringAll) && (
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
                    Gather all ({searchState.totalPages - searchState.currentPage} more pages)
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 text-xs"
                  onClick={loadNextPage}
                  disabled={!searchState?.hasMore || loadingMore || gatheringAll}
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

      {/* No provider configured hint */}
      {firecrawlConfigured === false && serperConfigured === false && (
        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span>
            <strong className="text-foreground">No search provider configured.</strong>{" "}
            Set up Firecrawl (recommended) for search and scraping, or add{" "}
            <code className="rounded bg-muted px-1 font-mono">SERPER_API_KEY</code> to your{" "}
            <code className="rounded bg-muted px-1 font-mono">.env</code> for Google search.
          </span>
        </div>
      )}

      {/* Scope + launch */}
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1.5">
          <Label className="text-xs">Scope</Label>
          <Select
            defaultValue={scope}
            value={scope}
            onValueChange={(v) => setScope(v as CrawlScope)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="page">Scrape selected pages only</SelectItem>
              <SelectItem value="domain">Crawl whole domain</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {scope === "domain" && (
          <div className="space-y-1.5 sm:w-32">
            <Label htmlFor="limit" className="text-xs">
              Max pages
            </Label>
            <Input
              id="limit"
              type="number"
              min={1}
              max={500}
              value={pageLimit}
              onChange={(e) => setPageLimit(Number(e.target.value) || 1)}
            />
          </div>
        )}
        <Button
          onClick={handleStartClick}
          disabled={disabled || starting || selectedUrls.length === 0}
        >
          {starting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Rocket className="size-4" />
          )}
          Start ETL job
          {selectedUrls.length > 0 && (
            <Badge variant="secondary" className="ml-1">
              {selectedUrls.length}
            </Badge>
          )}
        </Button>
      </div>

      {/* ETL estimation preview */}
      {selectedUrls.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Clock className="size-3.5" />
          <span>
            Estimated: {estimate.totalPages.toLocaleString()} pages ·{" "}
            {formatDuration(estimate.estimatedSeconds)}
          </span>
        </div>
      )}

      {/* Confirmation modal */}
      <ConfirmModal
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Start ETL Job?"
        description={`This will scrape ${selectedUrls.length} ${scope === "domain" ? "domain(s)" : "page(s)"}${scope === "domain" ? ` with up to ${pageLimit} pages each` : ""}.\n\n• Total pages: ~${estimate.totalPages.toLocaleString()}\n• Estimated time: ${formatDuration(estimate.estimatedSeconds)}\n\nThe job will run in the background. You can navigate away and check progress anytime.`}
        confirmText="Start ETL Job"
        onConfirm={startJob}
      />
    </div>
  )
}
