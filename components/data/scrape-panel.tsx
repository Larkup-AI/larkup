"use client"

import { useMemo, useState, useEffect } from "react"
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
} from "lucide-react"
import type { CrawlScope, SearchResultItem } from "@/core/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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

interface SearchState {
  results: SearchResultItem[]
  totalResults: number
  totalResultsIsEstimate: boolean
  currentPage: number
  totalPages: number
  hasMore: boolean
  query: string
  usingGoogle: boolean
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
  const [googleConfigured, setGoogleConfigured] = useState<boolean | null>(null)

  // Check if Google Search is configured on mount
  useEffect(() => {
    fetch("/api/search/google")
      .then((r) => r.json())
      .then((d) => setGoogleConfigured(d.configured ?? false))
      .catch(() => setGoogleConfigured(false))
  }, [])

  const selectedUrls = useMemo(
    () => Object.keys(selected).filter((u) => selected[u]),
    [selected],
  )

  /** Search using Google Custom Search API (with total count + pagination). */
  async function searchGoogle(page: number, append = false) {
    const isFirstPage = page === 1
    if (isFirstPage) {
      setSearching(true)
      if (!append) setSearchState(null)
    } else {
      setLoadingMore(true)
    }

    try {
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
        const existingResults = append && prev ? prev.results : []
        // Deduplicate
        const existingUrls = new Set(existingResults.map((r) => r.url))
        const fresh = newItems.filter((r) => !existingUrls.has(r.url))
        return {
          results: [...existingResults, ...fresh],
          totalResults: data.totalResults ?? 0,
          totalResultsIsEstimate: data.totalResultsIsEstimate ?? true,
          currentPage: data.currentPage ?? page,
          totalPages: data.totalPages ?? 1,
          hasMore: data.hasMore ?? false,
          query: data.query ?? query.trim(),
          usingGoogle: true,
        }
      })

      if (isFirstPage && (data.totalResults ?? 0) === 0) {
        toast.message("No results — try different keywords.")
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Search failed")
    } finally {
      setSearching(false)
      setLoadingMore(false)
    }
  }

  /** Fallback: Firecrawl-based search (no count / pagination). */
  async function searchFirecrawl() {
    setSearching(true)
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim(), limit: 15 }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Search failed")
      const results = (data.results as SearchResultItem[]) ?? []
      setSearchState({
        results,
        totalResults: results.length,
        totalResultsIsEstimate: false,
        currentPage: 1,
        totalPages: 1,
        hasMore: false,
        query: query.trim(),
        usingGoogle: false,
      })
      if (results.length === 0) toast.message("No results — try different keywords.")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Search failed")
    } finally {
      setSearching(false)
    }
  }

  async function runSearch() {
    if (!query.trim()) {
      toast.error("Enter one or more keywords to search.")
      return
    }
    setSelected({})
    if (googleConfigured) {
      await searchGoogle(1, false)
    } else {
      await searchFirecrawl()
    }
  }

  async function loadNextPage() {
    if (!searchState?.hasMore || loadingMore) return
    await searchGoogle(searchState.currentPage + 1, true)
  }

  /** Automatically paginate through ALL available Google results. */
  async function gatherAll() {
    if (!searchState || !searchState.usingGoogle) return
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
        // Small delay to be polite to the API
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
            usingGoogle: false,
          },
    )
    setSelected((prev) => ({ ...prev, [manualUrl]: true }))
    setManualUrl("")
  }

  async function startJob() {
    if (selectedUrls.length === 0) {
      toast.error("Select at least one URL to scrape.")
      return
    }
    setStarting(true)
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
      toast.success(
        `ETL job started · ${selectedUrls.length} ${scope === "domain" ? "domain(s)" : "page(s)"}`,
      )
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
    searchState?.usingGoogle && searchState.hasMore && !gatheringAll

  return (
    <div className="space-y-5">
      {/* Search bar */}
      <div className="space-y-2">
        <Label htmlFor="kw">Keywords / Organization</Label>
        <div className="flex gap-2">
          <Input
            id="kw"
            placeholder='e.g. "TUHH university Hamburg"'
            value={query}
            disabled={disabled}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runSearch()}
          />
          <Button onClick={runSearch} disabled={disabled || searching}>
            {searching ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Search className="size-4" />
            )}
            Search
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {googleConfigured === true
            ? "Using Serper.dev Google Search — see total result count and paginate through all results."
            : googleConfigured === false
              ? "Using Firecrawl search. Add SERPER_API_KEY to your .env for result counts & full pagination."
              : "Checking search provider…"}
        </p>
      </div>

      {/* Total count banner */}
      {searchState && searchState.totalResults > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
          <BarChart2 className="size-5 shrink-0 text-primary" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">
              {searchState.usingGoogle ? (
                searchState.totalResultsIsEstimate ? (
                  <>
                    <span className="text-primary">{results.length}</span> URLs loaded
                    {searchState.hasMore && (
                      <span className="text-muted-foreground font-normal"> · more pages available</span>
                    )}
                  </>
                ) : (
                  <>
                    About{" "}
                    <span className="text-primary">
                      {searchState.totalResults.toLocaleString()}
                    </span>{" "}
                    Google results for{" "}
                    <span className="italic">"{searchState.query}"</span>
                  </>
                )
              ) : (
                <>
                  <span className="text-primary">{searchState.totalResults}</span> results
                  found
                </>
              )}
            </p>
            {searchState.usingGoogle && (
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
          {searchState.usingGoogle && !searchState.hasMore && !gatheringAll && searchState.totalPages > 1 && (
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
          {searchState?.usingGoogle && (searchState.hasMore || loadingMore || gatheringAll) && (
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

      {/* Serper not configured hint */}
      {googleConfigured === false && (
        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span>
            <strong className="text-foreground">Enable Serper search</strong> for total
            Google result counts and full pagination. Add{" "}
            <code className="rounded bg-muted px-1 font-mono">SERPER_API_KEY</code> to your{" "}
            <code className="rounded bg-muted px-1 font-mono">.env</code> —{" "}
            get a free key at{" "}
            <a
              href="https://serper.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              serper.dev
            </a>.
          </span>
        </div>
      )}

      {/* Scope + launch */}
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1.5">
          <Label className="text-xs">Scope</Label>
          <Select value={scope} onValueChange={(v) => setScope(v as CrawlScope)}>
            <SelectTrigger>
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
        <Button onClick={startJob} disabled={disabled || starting || selectedUrls.length === 0}>
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
    </div>
  )
}
