"use client"

import { useState } from "react"
import {
  ArrowRight,
  Database,
  FileText,
  Search,
  Terminal,
  type LucideIcon,
} from "lucide-react"

type Tab = {
  id: string
  icon: LucideIcon
  label: string
  description: string
  preview: {
    title: string
    rows: { label: string; value: string }[]
    detail: { title: string; items: { name: string; desc: string }[] }
  }
}

const TABS: Tab[] = [
  {
    id: "ingest",
    icon: FileText,
    label: "Smart ingestion",
    description:
      "Paste text, upload Markdown, PDF or CSV, or crawl a site. Brew chunks and normalizes it for you.",
    preview: {
      title: "Ingestion complete",
      rows: [
        { label: "Source files", value: "12 files" },
        { label: "Raw words", value: "48,230" },
        { label: "After chunking", value: "520 chunks" },
        { label: "Overlap", value: "50 tokens" },
      ],
      detail: {
        title: "Document sources",
        items: [
          { name: "docs.md", desc: "Markdown · 12 KB" },
          { name: "faq.pdf", desc: "PDF · 840 KB" },
        ],
      },
    },
  },
  {
    id: "index",
    icon: Database,
    label: "Embed & index",
    description:
      "Pick an embedding model and vector store. Brew streams embeddings and writes them in one pass.",
    preview: {
      title: "Indexing in progress",
      rows: [
        { label: "Documents loaded", value: "47 files" },
        { label: "Chunks created", value: "1,284 chunks" },
        { label: "Embeddings stored", value: "1,284 vectors" },
        { label: "Index size", value: "4.2 MB" },
      ],
      detail: {
        title: "Embedding model",
        items: [
          { name: "text-embedding-3-small", desc: "OpenAI · 1536 dims" },
          { name: "text-embedding-3-large", desc: "OpenAI · 3072 dims" },
        ],
      },
    },
  },
  {
    id: "query",
    icon: Search,
    label: "Query & retrieve",
    description:
      "Query the corpus and get ranked chunks with source attribution and scores in milliseconds.",
    preview: {
      title: "Query results",
      rows: [
        { label: "Query", value: "how does indexing work?" },
        { label: "Top-k retrieved", value: "5 chunks" },
        { label: "Best match score", value: "0.94" },
        { label: "Latency", value: "82ms" },
      ],
      detail: {
        title: "Top hits",
        items: [
          { name: "Indexing Guide", desc: "score 0.94 · doc_8f2a" },
          { name: "Quick Start", desc: "score 0.89 · doc_1a3c" },
        ],
      },
    },
  },
  {
    id: "deploy",
    icon: Terminal,
    label: "Deploy anywhere",
    description:
      "Ship the pipeline from your terminal. Script it, run it in CI/CD, or self-host the server.",
    preview: {
      title: "Server running",
      rows: [
        { label: "Chunking", value: "100% complete" },
        { label: "Embedding", value: "100% complete" },
        { label: "Storing", value: "100% complete" },
        { label: "Time elapsed", value: "3.2s" },
      ],
      detail: {
        title: "Active servers",
        items: [
          { name: "support-bot", desc: "port 8080 · Pinecone" },
          { name: "docs-bot", desc: "port 8081 · pgvector" },
        ],
      },
    },
  },
]

export function FeatureTabs() {
  const [active, setActive] = useState(TABS[0].id)
  const tab = TABS.find((t) => t.id === active)!

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
            Four typed stages, one pipeline. Pick a step to see what Brew does
            under the hood.
          </p>
        </div>

        <div className="mt-14 flex flex-col gap-10">
          {/* Top: Horizontal tab list */}
          <div className="mx-auto flex flex-wrap justify-center gap-2.5">
            {TABS.map((t) => {
              const isActive = t.id === active
              const Icon = t.icon
              return (
                <button
                  key={t.id}
                  onClick={() => setActive(t.id)}
                  className={`group relative flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition-all duration-300 ${
                    isActive
                      ? "bg-primary text-primary-foreground shadow-md scale-105"
                      : "bg-secondary/50 text-muted-foreground hover:bg-secondary hover:text-foreground"
                  }`}
                >
                  <Icon className={`h-4 w-4 transition-colors ${isActive ? "text-primary-foreground" : "text-muted-foreground group-hover:text-foreground"}`} />
                  {t.label}
                </button>
              )
            })}
          </div>

          {/* Bottom: preview panel */}
          <div className="mx-auto w-full max-w-5xl overflow-hidden rounded-2xl border border-border bg-noise relative flex min-h-[420px] flex-col bg-card shadow-sm transition-all duration-500">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 opacity-70"
              style={{
                backgroundImage:
                  "radial-gradient(100% 80% at 50% 0%, color-mix(in oklch, var(--primary) 12%, transparent), transparent 60%)",
              }}
            />
            <div className="relative z-[1] flex items-center gap-2.5 border-b border-border px-6 py-4 bg-background/50 backdrop-blur-sm">
              <span className="flex h-2 w-2 rounded-full bg-primary" />
              <span className="text-sm font-medium text-foreground">
                {tab.preview.title}
              </span>
            </div>

            <div className="relative z-[1] flex flex-1 flex-col p-6 sm:p-10">
              <div className="mb-8 max-w-2xl">
                <h3 className="text-xl font-semibold text-foreground mb-2">{tab.label}</h3>
                <p className="text-base text-muted-foreground leading-relaxed">
                  {tab.description}
                </p>
              </div>

              <div className="grid gap-6 md:grid-cols-2 mt-auto">
                <div className="overflow-hidden rounded-xl border border-border bg-background/60 backdrop-blur">
                  {tab.preview.rows.map((row, i) => (
                    <div
                      key={i}
                      className="flex items-center border-b border-border last:border-b-0"
                    >
                      <div className="w-2/5 border-r border-border bg-secondary/30 px-5 py-3.5 text-sm text-muted-foreground">
                        {row.label}
                      </div>
                      <div className="flex-1 px-5 py-3.5 text-sm font-medium text-foreground">
                        {row.value}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="overflow-hidden rounded-xl border border-border bg-background/60 backdrop-blur">
                  <div className="flex items-center gap-2 border-b border-border bg-secondary/30 px-4 py-3">
                    <Search className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground">
                      {tab.preview.detail.title}
                    </span>
                  </div>
                  <div className="divide-y divide-border">
                    {tab.preview.detail.items.map((item, i) => (
                      <div key={i} className="px-4 py-3">
                        <p className="text-sm font-semibold text-foreground">
                          {item.name}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {item.desc}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-8 flex justify-end">
                <a
                  href="#docs"
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary transition-all hover:gap-2 hover:opacity-80"
                >
                  View documentation
                  <ArrowRight className="h-4 w-4" />
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
