"use client"

import { useState } from "react"
import { ArrowRight, Check, Copy, Star } from "lucide-react"
import { Button } from "@/components/ui/button"
import Link from "next/link"

export function Hero() {
  const [copied, setCopied] = useState(false)

  function copyCmd() {
    navigator.clipboard?.writeText("npm i @brew/core")
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <section className="relative overflow-hidden pt-32 pb-20 sm:pt-40 sm:pb-28">

      <div className="relative mx-auto flex max-w-3xl flex-col items-center px-4 text-center sm:px-6 lg:px-8">
        <a
          href="#docs"
          className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/60 px-3.5 py-1.5 text-xs text-muted-foreground backdrop-blur transition-colors hover:text-foreground"
        >
          <span className="flex h-1.5 w-1.5 rounded-full bg-primary" />
          Brew 2.1 — streaming reranker is live
          <ArrowRight className="h-3 w-3" />
        </a>

        <h1 className="mt-7 text-balance text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl">
          The RAG framework for <span className="text-primary">grounded</span> AI
          in production
        </h1>

        <p className="mt-6 max-w-2xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
          Brew connects any model to any source. Ingest, embed, retrieve, and
          rerank with a single typed pipeline — fully observable, framework
          agnostic, and open source.
        </p>

        <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row">
          <Button asChild size="lg" className="w-full transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg sm:w-auto">
            <Link href="/contact">
              Start brewing
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <button
            type="button"
            onClick={copyCmd}
            className="group flex w-full items-center justify-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5 font-mono text-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg sm:w-auto"
          >
            <span className="text-muted-foreground">$</span>
            <span className="text-foreground">npm i @brew/core</span>
            {copied ? (
              <Check className="h-4 w-4 text-primary" />
            ) : (
              <Copy className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground" />
            )}
          </button>
        </div>

        <div className="mt-7 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Star className="h-4 w-4 fill-primary text-primary" />
          <span className="font-medium text-foreground">14.2k</span> stars on
          GitHub — MIT licensed
        </div>
      </div>
    </section>
  )
}
