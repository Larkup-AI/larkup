"use client"

import { useState } from "react"
import { Globe, Terminal, FileText, Boxes, Search, ChevronRight } from "lucide-react"

const TABS = [
  {
    id: "web-ui",
    icon: Globe,
    label: "Visual Builder",
    description: "Use the Web UI to configure, upload data, index, and generate your RAG server.",
    learnMore: "#",
    preview: {
      title: "Indexing in progress",
      icon: DatabaseIcon,
      rows: [
        { label: "Documents loaded", value: "47 files" },
        { label: "Chunks created", value: "1,284 chunks" },
        { label: "Embeddings stored", value: "1,284 vectors" },
        { label: "Index size", value: "4.2 MB" },
      ],
      floatingCard: {
        title: "Selected model",
        items: [
          { name: "text-embedding-3-small", desc: "OpenAI · 1536 dimensions" },
          { name: "text-embedding-3-large", desc: "OpenAI · 3072 dimensions" },
        ]
      }
    },
  },
  {
    id: "cli",
    icon: Terminal,
    label: "CLI Pipeline",
    description: "Full pipeline from your terminal. Script it, run it in CI/CD, or just move fast.",
    learnMore: "#",
    preview: {
      title: "CLI Pipeline active",
      icon: Terminal,
      rows: [
        { label: "Chunking", value: "100% complete" },
        { label: "Embedding", value: "100% complete" },
        { label: "Storing", value: "100% complete" },
        { label: "Time elapsed", value: "3.2s" },
      ],
      floatingCard: {
        title: "Active servers",
        items: [
          { name: "support-bot", desc: "port 8080 · Pinecone" },
          { name: "docs-bot", desc: "port 8081 · LanceDB" },
        ]
      }
    },
  },
  {
    id: "data",
    icon: FileText,
    label: "Smart Ingestion",
    description: "Paste text, upload Markdown/PDF/CSV, or scrape websites with Firecrawl.",
    learnMore: "#",
    preview: {
      title: "Ingestion complete",
      icon: FileText,
      rows: [
        { label: "Source files", value: "12 files" },
        { label: "Raw words", value: "48,230" },
        { label: "After chunking", value: "520 chunks" },
        { label: "Overlap", value: "50 tokens" },
      ],
      floatingCard: {
        title: "Document sources",
        items: [
          { name: "docs.md", desc: "Markdown · 12 KB" },
          { name: "faq.pdf", desc: "PDF · 840 KB" },
        ]
      }
    },
  },
  {
    id: "query",
    icon: Search,
    label: "Query & Retrieve",
    description: "Query your indexed corpus and get ranked chunks with source attribution.",
    learnMore: "#",
    preview: {
      title: "Query results",
      icon: Search,
      rows: [
        { label: "Query", value: "how does indexing work?" },
        { label: "Top-k retrieved", value: "5 chunks" },
        { label: "Best match score", value: "0.94" },
        { label: "Latency", value: "82ms" },
      ],
      floatingCard: {
        title: "Top hits",
        items: [
          { name: "Indexing Guide", desc: "score 0.94 · doc_8f2a" },
          { name: "Quick Start", desc: "score 0.89 · doc_1a3c" },
        ]
      }
    },
  },
]

function DatabaseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
    </svg>
  )
}

export function FeatureTabs() {
  const [active, setActive] = useState("web-ui")
  const tab = TABS.find((t) => t.id === active)!

  return (
    <section className="border-b border-border bg-background" id="features">
      <div className="mx-auto max-w-[1400px]">
        <div className="flex flex-col md:flex-row border-x border-border min-h-[500px]">

          {/* ── Left column: tab list ── */}
          <div className="md:w-[320px] shrink-0 border-b md:border-b-0 md:border-r border-border flex flex-col bg-background">
            {TABS.map((t) => {
              const isActive = t.id === active
              return (
                <button
                  key={t.id}
                  onClick={() => setActive(t.id)}
                  className={`relative text-left px-8 py-6 border-b border-border last:border-b-0 transition-colors group ${
                    isActive ? "bg-[#f8fafc] dark:bg-white/5" : "hover:bg-secondary/40"
                  }`}
                >
                  {/* Active left border accent */}
                  {isActive && (
                    <span className="absolute left-[-1px] top-0 bottom-0 w-[3px] bg-caramel z-10" />
                  )}
                  <div className="flex items-center gap-3 mb-2">
                    <t.icon
                      className={`size-5 transition-colors ${isActive ? "text-caramel" : "text-muted-foreground group-hover:text-foreground"}`}
                    />
                    <span className={`text-base font-semibold ${isActive ? "text-caramel" : "text-foreground"}`}>
                      {t.label}
                    </span>
                  </div>
                  <p className="text-[13px] leading-relaxed text-muted-foreground">
                    {t.description}
                  </p>
                  {isActive && (
                    <a
                      href={t.learnMore}
                      className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold text-caramel hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Learn more
                      <ChevronRight className="size-3.5" />
                    </a>
                  )}
                </button>
              )
            })}
          </div>

          {/* ── Right panel: animated preview ── */}
          <div className="flex-1 relative bg-background flex flex-col">
            {/* Header */}
            <div className="px-8 py-6 border-b border-border flex items-center gap-3">
              <tab.preview.icon className="size-5 text-caramel" />
              <span className="text-base font-medium text-foreground">{tab.preview.title}</span>
            </div>
            
            {/* Table */}
            <div className="flex-1 p-8 pb-32">
              <div className="border border-border rounded-xl bg-card overflow-hidden">
                {tab.preview.rows.map((row, i) => (
                  <div key={i} className="flex flex-col sm:flex-row sm:items-center border-b border-border last:border-b-0">
                    <div className="sm:w-1/3 px-6 py-4 border-b sm:border-b-0 sm:border-r border-border text-sm text-muted-foreground bg-secondary/20">
                      {row.label}
                    </div>
                    <div className="flex-1 px-6 py-4 text-sm font-medium text-foreground">
                      {row.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Floating Card (matches the Search dropdown in Firecrawl) */}
            <div className="absolute right-8 top-20 w-80 bg-card border border-border rounded-xl shadow-2xl overflow-hidden hidden lg:block">
              <div className="px-4 py-3 border-b border-border bg-secondary/30 flex items-center gap-2">
                <Search className="size-4 text-muted-foreground" />
                <span className="text-sm font-medium text-foreground">{tab.preview.floatingCard.title}</span>
              </div>
              <div className="divide-y divide-border">
                {tab.preview.floatingCard.items.map((item, i) => (
                  <div key={i} className="px-4 py-4 hover:bg-secondary/40 transition-colors cursor-pointer">
                    <p className="text-sm font-semibold text-foreground mb-1">{item.name}</p>
                    <p className="text-xs text-muted-foreground">{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Bottom banner (like the Aemon banner in Firecrawl) */}
            <div className="mt-auto border-t border-border bg-[#f8fafc] dark:bg-white/5 px-8 py-6 flex items-center gap-6">
              <div className="px-3 py-1.5 border border-border bg-background rounded-md flex items-center gap-2 shrink-0">
                <DatabaseIcon className="size-3 text-caramel" />
                <span className="text-xs font-bold text-caramel">LarkupRAG</span>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  LarkupRAG powers your AI agents with clean data and instant retrieval.
                </p>
                <a href="#" className="mt-1 inline-flex items-center gap-1 text-[13px] font-semibold text-caramel hover:underline">
                  View documentation <ChevronRight className="size-3.5" />
                </a>
              </div>
            </div>

          </div>

        </div>
      </div>
    </section>
  )
}
