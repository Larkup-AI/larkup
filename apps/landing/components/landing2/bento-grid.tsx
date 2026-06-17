import {
  Gauge,
  GitBranch,
  Lock,
  Plug,
  ScanSearch,
  Workflow,
} from "lucide-react"

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string
  title: string
  description: string
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">
        {eyebrow}
      </p>
      <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
        {title}
      </h2>
      <p className="mt-4 text-pretty leading-relaxed text-muted-foreground">
        {description}
      </p>
    </div>
  )
}

/* A single stitched cell. Pass `glow` to give it a colored gradient wash. */
function Cell({
  className = "",
  glow,
  children,
}: {
  className?: string
  glow?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={`bg-noise group relative overflow-hidden bg-card p-6 transition-all duration-500 hover:z-10 hover:-translate-y-1 hover:shadow-xl sm:p-7 ${className}`}
    >
      {glow ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-80 transition-opacity duration-500 group-hover:opacity-100"
          style={{
            backgroundImage: `radial-gradient(150% 150% at 100% 0%, ${glow}, transparent 85%)`,
          }}
        />
      ) : null}
      <div className="relative z-[1] flex h-full flex-col">{children}</div>
    </div>
  )
}

const GLOW = {
  amber: "color-mix(in oklch, var(--primary) 30%, transparent)",
  blue: "color-mix(in oklch, oklch(0.6 0.15 250) 32%, transparent)",
  teal: "color-mix(in oklch, oklch(0.66 0.12 185) 30%, transparent)",
  rose: "color-mix(in oklch, oklch(0.62 0.17 20) 28%, transparent)",
}

export function BentoGrid() {
  return (
    <section id="docs" className="py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="Everything in the box"
          title="A complete retrieval engine, not just a wrapper"
          description="Brew ships the primitives you actually need to take RAG from prototype to production — typed, composable, and observable end to end."
        />

        {/* Outer frame — gap-px over a border-colored backdrop creates seamless stitched borders */}
        <div className="mt-14 overflow-hidden rounded-2xl border border-border bg-border">
          <div className="grid auto-rows-[minmax(190px,auto)] grid-cols-1 gap-px md:grid-cols-3">
            {/* Large feature card with code */}
            <Cell className="md:col-span-2 md:row-span-2" glow={GLOW.amber}>
              <div className="flex items-center gap-2">
                <Workflow className="h-5 w-5 text-primary" />
                <h3 className="font-semibold">Typed retrieval pipeline</h3>
              </div>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                Compose ingestion, chunking, embedding, retrieval, and reranking
                as type-safe steps. Swap any stage without touching the rest.
              </p>
              <div className="mt-auto overflow-hidden rounded-xl border border-border bg-background/70 backdrop-blur">
                <div className="flex items-center gap-1.5 border-b border-border px-4 py-2.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40" />
                  <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40" />
                  <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40" />
                  <span className="ml-2 font-mono text-xs text-muted-foreground">
                    pipeline.ts
                  </span>
                </div>
                <pre className="overflow-x-auto p-4 font-mono text-[12.5px] leading-relaxed">
                  <code>
                    <span className="text-primary">const</span> brew ={" "}
                    <span className="text-primary">createPipeline</span>({"{"}
                    {"\n"} {"  "}embed: openai(
                    <span className="text-foreground/70">
                      &quot;text-embedding-3&quot;
                    </span>
                    ),
                    {"\n"} {"  "}store: pgvector(db),
                    {"\n"} {"  "}rerank: cohere(
                    <span className="text-foreground/70">
                      &quot;rerank-v3&quot;
                    </span>
                    ),
                    {"\n"}
                    {"}"})
                    {"\n\n"}
                    <span className="text-primary">await</span> brew.query(question)
                  </code>
                </pre>
              </div>
            </Cell>

            {/* Stat card */}
            <Cell glow={GLOW.blue}>
              <Gauge className="h-5 w-5 text-primary" />
              <div className="mt-auto pt-8">
                <div className="text-4xl font-semibold tracking-tight">42ms</div>
                <p className="mt-1 text-sm text-muted-foreground">
                  median retrieval latency at p50, fully cached
                </p>
              </div>
            </Cell>

            {/* Hybrid search */}
            <Cell glow={GLOW.teal}>
              <ScanSearch className="h-5 w-5 text-primary" />
              <h3 className="mt-3 font-semibold">Hybrid search</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                Dense + sparse fusion with built-in reranking for higher recall.
              </p>
            </Cell>

            {/* Connectors */}
            <Cell>
              <Plug className="h-5 w-5 text-primary" />
              <h3 className="mt-3 font-semibold">40+ connectors</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                S3, Notion, Postgres, GitHub, Drive and more — incremental sync
                out of the box.
              </p>
            </Cell>

            {/* Versioned indexes */}
            <Cell>
              <GitBranch className="h-5 w-5 text-primary" />
              <h3 className="mt-3 font-semibold">Versioned indexes</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                Branch, diff, and roll back your knowledge base like code.
              </p>
            </Cell>

            {/* Security */}
            <Cell glow={GLOW.rose}>
              <Lock className="h-5 w-5 text-primary" />
              <h3 className="mt-3 font-semibold">Private by default</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                Row-level access control and PII redaction on ingest. Self-host
                anywhere.
              </p>
            </Cell>
          </div>
        </div>
      </div>
    </section>
  )
}
