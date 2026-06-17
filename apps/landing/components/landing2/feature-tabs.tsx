"use client"

import { useState, useEffect } from "react"
import {
  ArrowRight,
  Database,
  FileText,
  Search,
  Settings,
  Play,
  CheckCircle2,
  Loader2,
  Cpu,
  Boxes,
  Scissors,
  Hash,
  CornerDownLeft,
  type LucideIcon,
} from "lucide-react"

type Tab = {
  id: string
  icon: LucideIcon
  label: string
  description: string
}

const TABS: Tab[] = [
  {
    id: "configure",
    icon: Settings,
    label: "Configure pipeline",
    description:
      "Pick an embedding model, vector store, and index type. Larkup RAG validates your credentials and locks-in settings in one step.",
  },
  {
    id: "ingest",
    icon: FileText,
    label: "Ingest & chunk",
    description:
      "Upload PDFs, Markdown, CSV, or crawl a URL. Larkup RAG chunks and normalizes your corpus automatically.",
  },
  {
    id: "index",
    icon: Database,
    label: "Embed & index",
    description:
      "Larkup RAG streams embeddings and upserts them into your vector store in a single pass with live progress.",
  },
  {
    id: "query",
    icon: Search,
    label: "Query & retrieve",
    description:
      "Get ranked results with source attribution and similarity scores in milliseconds — via the UI or your deployed server.",
  },
]

/* ── Animated configure preview ── */
function ConfigurePreview() {
  const [provider, setProvider] = useState(0)
  const providers = ["OpenAI", "Cohere", "Mistral", "Voyage AI"]
  const stores = ["Pinecone", "pgvector", "Qdrant", "LanceDB"]
  const [store, setStore] = useState(0)

  useEffect(() => {
    const t = setInterval(() => {
      setProvider((p) => (p + 1) % providers.length)
    }, 1800)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const t = setInterval(() => {
      setStore((s) => (s + 1) % stores.length)
    }, 2400)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="flex flex-1 flex-col animate-in fade-in slide-in-from-bottom-2 duration-500 fill-mode-both">
      <div className="flex items-center gap-2.5 border-b border-border px-6 py-4 bg-background/50 backdrop-blur-sm">
        <Settings className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium text-foreground">Configure — Embedding & Vector Store</span>
      </div>

      <div className="flex flex-1 flex-col gap-4 p-6 sm:p-8">
        {/* Embedding model */}
        <div className="overflow-hidden rounded-xl border border-border bg-background/60 backdrop-blur">
          <div className="border-b border-border bg-secondary/30 px-4 py-2.5 flex items-center gap-2">
            <Cpu className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Embedding model</span>
          </div>
          <div className="px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded bg-neutral-100 dark:bg-neutral-800 text-xs">🤖</span>
              <div>
                <p className="text-sm font-semibold text-foreground transition-all duration-500 key={provider}">
                  {providers[provider]}
                </p>
                <p className="text-xs text-muted-foreground">1536 dims · 8k tokens</p>
              </div>
            </div>
            <span className="rounded-full border border-primary/40 px-2 py-0.5 text-[10px] font-medium text-primary">active</span>
          </div>
        </div>

        {/* Vector store */}
        <div className="overflow-hidden rounded-xl border border-border bg-background/60 backdrop-blur">
          <div className="border-b border-border bg-secondary/30 px-4 py-2.5 flex items-center gap-2">
            <Database className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Vector store</span>
          </div>
          <div className="px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded bg-green-50 dark:bg-green-950/40 text-xs">🗄️</span>
              <div>
                <p className="text-sm font-semibold text-foreground transition-all duration-500">
                  {stores[store]}
                </p>
                <p className="text-xs text-muted-foreground">Connection verified</p>
              </div>
            </div>
            <span className="flex items-center gap-1.5 text-xs text-green-600 font-medium">
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
                <span className="relative inline-flex size-1.5 rounded-full bg-green-500" />
              </span>
              Connected
            </span>
          </div>
        </div>

        {/* Index type */}
        <div className="overflow-hidden rounded-xl border border-border bg-background/60 backdrop-blur">
          <div className="border-b border-border bg-secondary/30 px-4 py-2.5 flex items-center gap-2">
            <Boxes className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Index type</span>
          </div>
          <div className="flex divide-x divide-border">
            {["Lexical", "Semantic", "Hybrid"].map((t) => (
              <div
                key={t}
                className={`flex-1 px-3 py-2.5 text-center text-xs font-medium transition-colors ${
                  t === "Hybrid" ? "bg-primary/10 text-primary" : "text-muted-foreground"
                }`}
              >
                {t}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Animated ingest preview ── */
function IngestPreview() {
  const files = [
    { name: "docs.md", type: "Markdown", size: "12 KB", chunks: 42 },
    { name: "faq.pdf", type: "PDF", size: "840 KB", chunks: 128 },
    { name: "data.csv", type: "CSV", size: "2.1 MB", chunks: 350 },
  ]
  const [progress, setProgress] = useState(0)
  const [activeFile, setActiveFile] = useState(0)

  useEffect(() => {
    const t = setInterval(() => {
      setProgress((p) => {
        if (p >= 100) {
          setActiveFile((f) => (f + 1) % files.length)
          return 0
        }
        return p + 4
      })
    }, 80)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="flex flex-1 flex-col animate-in fade-in slide-in-from-bottom-2 duration-500 fill-mode-both">
      <div className="flex items-center gap-2.5 border-b border-border px-6 py-4 bg-background/50 backdrop-blur-sm">
        <span className="flex h-2 w-2 rounded-full bg-primary animate-pulse" />
        <span className="text-sm font-medium text-foreground">Ingesting documents…</span>
      </div>

      <div className="flex flex-1 flex-col gap-4 p-6 sm:p-8">
        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Files", value: "3" },
            { label: "After chunking", value: "520" },
            { label: "Overlap", value: "50 tokens" },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-border bg-background/60 backdrop-blur px-4 py-3 text-center">
              <div className="text-lg font-bold text-foreground tabular-nums">{s.value}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        {/* File list */}
        <div className="overflow-hidden rounded-xl border border-border bg-background/60 backdrop-blur">
          <div className="border-b border-border bg-secondary/30 px-4 py-2.5 flex items-center gap-2">
            <FileText className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">Document sources</span>
          </div>
          <div className="divide-y divide-border">
            {files.map((f, i) => (
              <div key={f.name} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">{f.name}</p>
                  <p className="text-xs text-muted-foreground">{f.type} · {f.size} · {f.chunks} chunks</p>
                </div>
                {i < activeFile ? (
                  <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                ) : i === activeFile ? (
                  <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" />
                ) : (
                  <span className="h-4 w-4 rounded-full border-2 border-border shrink-0" />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Progress */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Chunking {files[activeFile]?.name ?? "…"}</span>
            <span className="tabular-nums">{progress}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full bg-primary transition-all duration-100 rounded-full"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Animated index preview ── */
function IndexPreview() {
  const phases = [
    { label: "Chunking", phase: "Splitting documents into chunks" },
    { label: "Embedding", phase: "Generating vector embeddings" },
    { label: "Storing", phase: "Writing vectors to the store" },
  ]
  const [phaseIdx, setPhaseIdx] = useState(0)
  const [pct, setPct] = useState(12)
  const [chunks, setChunks] = useState(0)
  const total = 1284

  useEffect(() => {
    const t = setInterval(() => {
      setChunks((c) => {
        if (c >= total) {
          setPhaseIdx((p) => (p + 1) % phases.length)
          return 0
        }
        return c + 17
      })
    }, 50)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    setPct(Math.min(100, Math.round((chunks / total) * 100)))
  }, [chunks])

  return (
    <div className="flex flex-1 flex-col animate-in fade-in slide-in-from-bottom-2 duration-500 fill-mode-both">
      <div className="flex items-center gap-2.5 border-b border-border px-6 py-4 bg-background/50 backdrop-blur-sm">
        <span className="flex items-center gap-1.5 text-xs font-medium text-green-600">
          <span className="relative flex size-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-green-500" />
          </span>
          Live
        </span>
        <span className="text-sm font-medium text-foreground">Indexing in progress</span>
      </div>

      <div className="flex flex-1 flex-col gap-4 p-6 sm:p-8">
        {/* Config row */}
        <div className="overflow-hidden rounded-xl border border-border bg-background/60 backdrop-blur">
          <div className="grid grid-cols-2 divide-x divide-y divide-border sm:grid-cols-4 sm:divide-y-0">
            {[
              { icon: Cpu, label: "Model", value: "text-emb-3-small" },
              { icon: Database, label: "Store", value: "Pinecone" },
              { icon: Boxes, label: "Index", value: "HYBRID" },
              { icon: Scissors, label: "Chunks", value: "512 / 50" },
            ].map((it) => (
              <div key={it.label} className="flex flex-col gap-1 px-4 py-3">
                <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <it.icon className="h-3 w-3" />
                  {it.label}
                </dt>
                <dd className="text-xs font-mono font-medium">{it.value}</dd>
              </div>
            ))}
          </div>
        </div>

        {/* Phase tabs */}
        <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-0.5">
          {phases.map((p, i) => (
            <div
              key={p.label}
              className={`flex-1 rounded-md px-2 py-1.5 text-center text-xs font-medium transition-colors ${
                i === phaseIdx
                  ? "bg-background border border-border text-foreground shadow-sm"
                  : i < phaseIdx
                  ? "text-primary"
                  : "text-muted-foreground"
              }`}
            >
              {i < phaseIdx ? "✓ " : ""}{p.label}
            </div>
          ))}
        </div>

        {/* Progress */}
        <div className="overflow-hidden rounded-xl border border-border bg-background/60 backdrop-blur p-4 space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{phases[phaseIdx].phase}</span>
            <span className="font-mono tabular-nums text-xs">
              {Math.min(chunks, total).toLocaleString()} / {total.toLocaleString()} chunks
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full bg-green-500 transition-all duration-100 rounded-full"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{pct}% complete</span>
            <span>~{Math.max(0, Math.round((total - chunks) / 17 * 0.05))}s remaining</span>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "Documents", value: "47" },
            { label: "Chunks", value: total.toLocaleString() },
            { label: "Dimensions", value: "1,536" },
            { label: "Index size", value: "4.2 MB" },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-border bg-background/60 backdrop-blur px-3 py-2.5 text-center">
              <div className="text-sm font-bold text-foreground tabular-nums">{s.value}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ── Animated query preview ── */
function QueryPreview() {
  const queries = [
    "How does retrieval work?",
    "What chunking strategy is best?",
    "How do I deploy to production?",
  ]
  const [qIdx, setQIdx] = useState(0)
  const [typing, setTyping] = useState(false)
  const [typed, setTyped] = useState("")
  const [searching, setSearching] = useState(false)
  const [showResults, setShowResults] = useState(true)

  const results = [
    { title: "Retrieval Guide", score: 94, text: "Vector retrieval works by embedding the query and computing cosine similarity against indexed chunks…" },
    { title: "Quick Start", score: 89, text: "Set up your pipeline in minutes with any embedding model and vector store of your choice…" },
    { title: "Architecture Docs", score: 81, text: "Larkup RAG uses a typed pipeline pattern where each stage is individually swappable…" },
  ]

  useEffect(() => {
    const cycle = async () => {
      const q = queries[qIdx]
      setShowResults(false)
      setTyped("")
      setTyping(true)
      // type it out
      for (let i = 0; i <= q.length; i++) {
        await new Promise((r) => setTimeout(r, 40))
        setTyped(q.slice(0, i))
      }
      setTyping(false)
      setSearching(true)
      await new Promise((r) => setTimeout(r, 900))
      setSearching(false)
      setShowResults(true)
      await new Promise((r) => setTimeout(r, 3000))
      setQIdx((i) => (i + 1) % queries.length)
    }
    cycle()
  }, [qIdx])

  return (
    <div className="flex flex-1 flex-col animate-in fade-in slide-in-from-bottom-2 duration-500 fill-mode-both">
      <div className="flex items-center gap-2.5 border-b border-border px-6 py-4 bg-background/50 backdrop-blur-sm">
        <Search className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium text-foreground">Query results</span>
        {showResults && (
          <span className="ml-auto font-mono text-xs text-muted-foreground">82ms</span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3 p-5 sm:p-7">
        {/* Search input */}
        <div className="relative overflow-hidden rounded-xl border border-border bg-background/60 backdrop-blur">
          <div className="flex items-center gap-2 px-4 py-3">
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="flex-1 text-sm text-foreground font-mono min-h-[20px]">
              {typed}
              {typing && <span className="inline-block w-0.5 h-4 bg-primary ml-0.5 animate-pulse align-middle" />}
            </span>
            <button className="flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground">
              {searching ? <Loader2 className="h-3 w-3 animate-spin" /> : <CornerDownLeft className="h-3 w-3" />}
              {searching ? "…" : "Search"}
            </button>
          </div>
        </div>

        {/* Top-k selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Top-k</span>
          <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-0.5">
            {[1, 3, 5, 8, 10].map((k) => (
              <div
                key={k}
                className={`min-w-7 rounded-md px-2 py-0.5 text-xs font-medium text-center tabular-nums transition-colors ${
                  k === 5 ? "bg-background border border-border text-foreground shadow-sm" : "text-muted-foreground"
                }`}
              >
                {k}
              </div>
            ))}
          </div>
          {showResults && (
            <span className="ml-auto text-xs text-muted-foreground">
              {results.length} results
            </span>
          )}
        </div>

        {/* Results */}
        {searching && (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="overflow-hidden rounded-xl border border-border bg-background/60 backdrop-blur p-3 flex gap-3 animate-pulse">
                <div className="h-7 w-7 rounded-md bg-muted shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-1/3 bg-muted rounded" />
                  <div className="h-2 w-full bg-muted rounded" />
                  <div className="h-2 w-4/5 bg-muted rounded" />
                </div>
              </div>
            ))}
          </div>
        )}

        {showResults && (
          <div className="space-y-2 animate-in fade-in duration-300">
            {results.map((r, i) => (
              <div key={r.title} className="overflow-hidden rounded-xl border border-border bg-background/60 backdrop-blur p-3 flex gap-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-xs font-semibold tabular-nums text-muted-foreground shrink-0">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="text-xs font-semibold text-foreground truncate">{r.title}</p>
                    <span className="shrink-0 rounded-full bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-foreground">
                      {r.score}%
                    </span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-muted-foreground line-clamp-2">{r.text}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const PREVIEWS: Record<string, React.FC> = {
  configure: ConfigurePreview,
  ingest: IngestPreview,
  index: IndexPreview,
  query: QueryPreview,
}

export function FeatureTabs() {
  const [active, setActive] = useState(TABS[0].id)
  const tab = TABS.find((t) => t.id === active)!
  const Preview = PREVIEWS[active]

  return (
    <section id="how-it-works" className="py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">
            How it works
          </p>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            From raw documents to grounded answers
          </h2>
          <p className="mt-4 text-pretty leading-relaxed text-muted-foreground">
            Four typed stages, one pipeline. Pick a step to see what Larkup RAG
            does under the hood.
          </p>
        </div>

        <div className="mt-14 flex flex-col lg:flex-row rounded border border-border/50 bg-card/50 overflow-hidden mx-auto max-w-6xl">
          {/* Left: Vertical tab list */}
          <div className="flex flex-col w-full lg:w-[340px] shrink-0 border-b lg:border-b-0 lg:border-r border-border bg-secondary/10">
            {TABS.map((t) => {
              const isActive = t.id === active
              const Icon = t.icon
              return (
                <button
                  key={t.id}
                  onClick={() => setActive(t.id)}
                  className={`group relative flex flex-col items-start p-6 text-left transition-all duration-300 border-l-2 border-b border-b-border/40 last:border-b-0 ${
                    isActive
                      ? "border-l-primary bg-primary/5"
                      : "border-l-transparent hover:bg-secondary/40"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon className={`h-4 w-4 transition-colors ${isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"}`} />
                    <span className={`font-semibold text-base ${isActive ? "text-foreground" : "text-foreground/80"}`}>{t.label}</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-2 text-balance leading-relaxed">
                    {t.description}
                  </p>
                  {isActive && (
                    <span className="mt-3 text-xs font-semibold text-primary inline-flex items-center gap-1.5 opacity-0 animate-in fade-in slide-in-from-left-1 duration-300 fill-mode-both">
                      See it live <ArrowRight className="h-3 w-3" />
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Right: preview panel */}
          <div className="flex-1 relative flex flex-col bg-noise bg-card min-h-[520px]">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 opacity-70 transition-opacity duration-500"
              style={{
                backgroundImage:
                  "radial-gradient(100% 80% at 50% 0%, color-mix(in oklch, var(--primary) 12%, transparent), transparent 60%)",
              }}
            />

            <div key={active} className="relative z-1 flex flex-1 flex-col">
              <Preview />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
