"use client"

import { useState } from "react"
import { Plus } from "lucide-react"

const FAQS = [
  {
    q: "What is Brew, exactly?",
    a: "Brew is an open-source RAG framework. It gives you a typed, composable pipeline to ingest data, embed it, store it in any vector database, and retrieve grounded context for your LLM — without stitching together a dozen libraries yourself.",
  },
  {
    q: "Which models and vector stores are supported?",
    a: "Any of them. Brew ships first-class adapters for OpenAI, Anthropic, Mistral, Cohere and local models, plus Pinecone, Weaviate, pgvector, and more. Swapping a provider is a one-line change.",
  },
  {
    q: "Do I have to self-host?",
    a: "No. Brew runs anywhere Node runs — your laptop, a serverless function, or your own cluster. Self-hosting is fully supported for teams with strict data-residency requirements, but it is never required.",
  },
  {
    q: "How is Brew different from a vector database?",
    a: "A vector database only stores and searches embeddings. Brew orchestrates the entire retrieval lifecycle around it: ingestion, chunking, embedding, hybrid search, reranking, and observability — with the vector store as one pluggable piece.",
  },
  {
    q: "Is it really free and open source?",
    a: "Yes. The core framework is MIT licensed and free forever. We offer optional enterprise support, managed hosting, and SSO for teams that want them, but the framework itself has no paywall.",
  },
  {
    q: "How do I get started?",
    a: "Run npm i @brew/core, point Brew at a data source, and call query(). Most teams have a working retrieval pipeline in under ten minutes by following the quick-start guide in the docs.",
  },
]

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="bg-card transition-colors hover:bg-secondary/30">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-6 px-6 py-5 text-left"
      >
        <span className="text-base font-medium text-foreground">{q}</span>
        <Plus
          className={`h-5 w-5 shrink-0 text-primary transition-transform duration-300 ${
            open ? "rotate-45" : ""
          }`}
        />
      </button>
      <div
        className={`grid transition-all duration-300 ease-out ${
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          <p className="px-6 pb-5 text-sm leading-relaxed text-muted-foreground">
            {a}
          </p>
        </div>
      </div>
    </div>
  )
}

export function FaqSection() {
  return (
    <section id="faq" className="py-20 sm:py-28">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-[minmax(0,360px)_1fr] lg:gap-16 lg:px-8">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">
            FAQ
          </p>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Frequently asked questions
          </h2>
          <p className="mt-4 text-pretty leading-relaxed text-muted-foreground">
            Everything you need to know about Brew. Can&apos;t find an answer?{" "}
            <a href="#contact" className="text-primary hover:underline">
              Talk to our team
            </a>
            .
          </p>
        </div>

        <div className="overflow-hidden rounded-2xl border border-border bg-border">
          <div className="flex flex-col gap-px">
            {FAQS.map((f) => (
              <FaqItem key={f.q} q={f.q} a={f.a} />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
