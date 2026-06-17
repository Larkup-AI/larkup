"use client"

import { Settings, Database, Cpu, Server, MessageSquare } from "lucide-react"

const STEPS = [
  {
    number: "01",
    icon: Settings,
    title: "Configure",
    description:
      "Choose your embedding model, index type, chunking strategy, and vector store. One config — Web UI or CLI.",
    color: "from-blue-500 to-caramel",
  },
  {
    number: "02",
    icon: Database,
    title: "Ingest Data",
    description:
      "Paste text, upload files, or scrape the web. Support for Markdown, PDF, CSV, and Firecrawl ETL out of the box.",
    color: "from-caramel to-cyan-400",
  },
  {
    number: "03",
    icon: Cpu,
    title: "Index",
    description:
      "Chunk, embed, and store your corpus into the selected vector store with a single command. Live progress tracking included.",
    color: "from-cyan-400 to-teal-400",
  },
  {
    number: "04",
    icon: Server,
    title: "Generate Server",
    description:
      "Emit a standalone, dependency-light RAG server. Includes Dockerfile, docker-compose.yml, and Vercel config.",
    color: "from-teal-400 to-emerald-400",
  },
  {
    number: "05",
    icon: MessageSquare,
    title: "Query & Demo",
    description:
      "Send test queries, inspect top-k retrieved chunks, and validate your pipeline — all before shipping to production.",
    color: "from-emerald-400 to-green-400",
  },
]

export function PipelineSteps() {
  return (
    <section className="relative py-24 md:py-36" id="pipeline">
      <div className="mx-auto max-w-6xl px-6">
        {/* Section header */}
        <div className="text-center max-w-2xl mx-auto mb-16 md:mb-20">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-caramel mb-3">
            The Pipeline
          </p>
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight">
            Five steps from{" "}
            <span className="gradient-text">raw data to production</span>
          </h2>
          <p className="mt-4 text-muted-foreground text-lg">
            A clear, opinionated pipeline that walks you through every stage — so
            you focus on your data, not the plumbing.
          </p>
        </div>

        {/* Steps */}
        <div className="relative">
          {/* Vertical connector line */}
          <div className="absolute left-[27px] md:left-1/2 top-0 bottom-0 w-px bg-gradient-to-b from-caramel/30 via-caramel/10 to-transparent hidden md:block" />

          <div className="space-y-8 md:space-y-0">
            {STEPS.map((step, i) => {
              const isLeft = i % 2 === 0
              return (
                <div
                  key={step.number}
                  className="relative md:grid md:grid-cols-2 md:gap-12 md:items-center md:py-8"
                >
                  {/* Timeline dot (desktop) */}
                  <div className="hidden md:flex absolute left-1/2 -translate-x-1/2 z-10">
                    <div className={`size-3 rounded-full bg-gradient-to-br ${step.color} shadow-[0_0_12px_rgba(26,107,255,0.4)]`} />
                  </div>

                  {/* Card */}
                  <div
                    className={`${isLeft ? "md:col-start-1 md:text-right md:pr-12" : "md:col-start-2 md:pl-12"}`}
                  >
                    <div className="group p-6 rounded-2xl border border-border/50 bg-card/60 dark:bg-card/40 backdrop-blur-sm hover:border-caramel/25 hover:bg-caramel-muted/50 transition-all duration-300">
                      <div className={`flex items-center gap-3 mb-3 ${isLeft ? "md:justify-end" : ""}`}>
                        <div className={`size-10 rounded-xl bg-gradient-to-br ${step.color} flex items-center justify-center shadow-lg`}>
                          <step.icon className="size-5 text-white" />
                        </div>
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-caramel">
                            Step {step.number}
                          </span>
                          <h3 className="text-lg font-semibold text-foreground -mt-0.5">
                            {step.title}
                          </h3>
                        </div>
                      </div>
                      <p className={`text-sm text-muted-foreground leading-relaxed ${isLeft ? "md:text-right" : ""}`}>
                        {step.description}
                      </p>
                    </div>
                  </div>

                  {/* Empty col for alternation */}
                  {isLeft && <div className="hidden md:block" />}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
