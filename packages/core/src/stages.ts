import type { StageMeta } from "./types"

/**
 * The five pipeline stages, in order. Drives the sidebar nav and the
 * "coming in phase N" gating for stages not yet implemented.
 */
export const STAGES: StageMeta[] = [
  {
    id: "configure",
    label: "Configure",
    href: "/configure",
    description: "Embedding model, index type, chunking, and vector store.",
    phase: 1,
  },
  {
    id: "data",
    label: "Data",
    href: "/data",
    description: "Paste, upload, or scrape the web with the Firecrawl ETL.",
    phase: 2,
  },
  {
    id: "index",
    label: "Index",
    href: "/index-data",
    description: "Chunk, embed, and store into your selected vector store.",
    phase: 3,
  },
  {
    id: "server",
    label: "Server",
    href: "/server",
    description: "Generate and launch a lightweight, deployable RAG server.",
    phase: 4,
  },
  {
    id: "demo",
    label: "Demo",
    href: "/demo",
    description: "Send a test query and inspect the top-k documents.",
    phase: 5,
  },
]

/** The phase currently shipped. Stages above this render as "coming soon". */
export const CURRENT_PHASE = 5
