"use client"

import { useState } from "react"
import { Plus } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"

const FAQS = [
  {
    q: "What is Larkup RAG?",
    a: "Larkup RAG is an open-source framework for building production-grade Retrieval-Augmented Generation applications. It provides a fully typed, composable pipeline covering everything from data ingestion and chunking to embedding, vector storage, retrieval, and deployment — without stitching together a dozen libraries yourself.",
  },
  {
    q: "Can I build a custom agentic RAG app with it?",
    a: "Absolutely. Larkup RAG's pipeline is modular and framework-agnostic. You can compose retrieval steps with any agent loop — LangChain, custom tool-calling agents, or plain async Node. Each stage (ingest → chunk → embed → retrieve) is individually swappable so you can plug it into any agentic workflow.",
  },
  {
    q: "Which LLM providers and vector stores are supported?",
    a: "Larkup RAG ships first-class adapters for OpenAI, Anthropic, Mistral, Cohere, Gemini, and local models via Ollama. For vector stores, it supports Pinecone, Weaviate, pgvector, Qdrant, LanceDB, Chroma, and Supabase. Swapping a provider is a one-line config change.",
  },
  {
    q: "How does the data ingestion pipeline work?",
    a: "You can feed data in three ways: paste text directly, upload files (PDF, Markdown, CSV, JSON), or configure a web source. Larkup RAG then chunks your corpus, generates embeddings, and stores them in your chosen vector store — all orchestrated through a single typed pipeline with real-time progress.",
  },
  {
    q: "How do I deploy the generated RAG server?",
    a: "Configure your pipeline in the Web UI, run indexing, then deploy the generated standalone Node ESM server. It ships with a Dockerfile and vercel.json so you can go live on any platform in minutes — only the packages you actually use are bundled.",
  },
  {
    q: "Is Larkup RAG free and open source?",
    a: "Yes. The core framework is MIT-licensed and free forever. Optional enterprise support, managed hosting, and SSO are available for teams that need them, but the framework itself has no paywall and no feature limits.",
  },
  {
    q: "How quickly can I get a working RAG pipeline?",
    a: "Most developers have a working retrieval pipeline in under ten minutes. Install Larkup RAG, point it at a data source, configure your embedding model and vector store through the Web UI, run indexing, and start querying. The step-by-step UI guides you through each stage.",
  },
]

function FaqItem({ q, a, index }: { q: string; a: string; index: number }) {
  const [open, setOpen] = useState(false)

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4, delay: index * 0.06, ease: "easeOut" }}
      className="bg-card transition-colors cursor-pointer! hover:bg-[#F6F6F6] dark:bg-secondary/10"
    >
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-6 px-6 py-5 text-left"
      >
        <span className="text-base font-medium text-foreground">{q}</span>
        <motion.div
          animate={{ rotate: open ? 45 : 0 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="shrink-0"
        >
          <Plus className="h-5 w-5 text-primary" />
        </motion.div>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="answer"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <p className="px-6 pb-5 text-sm leading-relaxed text-muted-foreground">
              {a}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

export function FaqSection() {
  return (
    <section id="faq" className="py-20 sm:py-28">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-[minmax(0,340px)_1fr] lg:gap-16 lg:px-8">
        {/* Left sticky header */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="lg:sticky lg:top-28 lg:self-start"
        >
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">
            FAQ
          </p>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Frequently asked questions
          </h2>
          <p className="mt-4 text-pretty leading-relaxed text-muted-foreground">
            Everything you need to know about Larkup RAG. Can&apos;t find an
            answer?{" "}
            <a href="/contact" className="text-primary hover:underline">
              Talk to our team
            </a>
            .
          </p>
        </motion.div>

        {/* Right FAQ list */}
        <div className="overflow-hidden rounded-2xl border border-border bg-border">
          <div className="flex flex-col gap-px">
            {FAQS.map((f, i) => (
              <FaqItem key={f.q} q={f.q} a={f.a} index={i} />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
