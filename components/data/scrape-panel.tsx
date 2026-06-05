"use client"

import { useMemo, useState } from "react"
import { toast } from "sonner"
import { Globe, Loader2, Plus, Rocket, Search } from "lucide-react"
import type { CrawlScope, SearchResultItem } from "@/core/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
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

export function ScrapePanel({
  disabled,
  onStarted,
}: {
  disabled: boolean
  onStarted: () => void
}) {
  const [query, setQuery] = useState("")
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<SearchResultItem[]>([])
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [scope, setScope] = useState<CrawlScope>("domain")
  const [pageLimit, setPageLimit] = useState(25)
  const [manualUrl, setManualUrl] = useState("")
  const [starting, setStarting] = useState(false)

  const selectedUrls = useMemo(
    () => Object.keys(selected).filter((u) => selected[u]),
    [selected],
  )

  async function runSearch() {
    if (!query.trim()) {
      toast.error("Enter one or more keywords to search.")
      return
    }
    setSearching(true)
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, limit: 15 }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Search failed")
      setResults(data.results as SearchResultItem[])
      if ((data.results as SearchResultItem[]).length === 0) {
        toast.message("No results — try different keywords.")
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Search failed")
    } finally {
      setSearching(false)
    }
  }

  function addManual() {
    if (!/^https?:\/\//i.test(manualUrl)) {
      toast.error("Enter a full URL starting with http(s)://")
      return
    }
    const item: SearchResultItem = { url: manualUrl, title: domainOf(manualUrl) }
    setResults((prev) =>
      prev.some((r) => r.url === item.url) ? prev : [item, ...prev],
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

  return (
    <div className="space-y-5">
      {/* Search */}
      <div className="space-y-2">
        <Label htmlFor="kw">Keywords</Label>
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
          Search the web for sources about an institution, then select pages or
          whole domains to aggregate.
        </p>
      </div>

      {/* Add a URL manually */}
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

      {/* Results */}
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
              {selectedUrls.length === results.length
                ? "Clear all"
                : "Select all"}
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
        </Button>
      </div>
    </div>
  )
}
