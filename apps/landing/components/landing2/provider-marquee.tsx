import {
  ArrowUpRight,
  Boxes,
  Bot,
  Brain,
  Cloud,
  Cpu,
  Database,
  Layers,
  Network,
  Sparkles,
  Zap,
} from "lucide-react"

const providers = [
  { name: "OpenAI", icon: Sparkles },
  { name: "Anthropic", icon: Bot },
  { name: "Mistral", icon: Zap },
  { name: "Cohere", icon: Layers },
  { name: "Llama", icon: Brain },
  { name: "Pinecone", icon: Network },
  { name: "Weaviate", icon: Boxes },
  { name: "pgvector", icon: Database },
  { name: "Bedrock", icon: Cloud },
  { name: "Vertex", icon: Cpu },
]

export function ProviderMarquee() {
  const row = [...providers, ...providers]

  return (
    <section id="providers" className="border-y border-border bg-card/30">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <p className="text-center text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground">
          Plug into every model &amp; vector store
        </p>
      </div>

      <div className="marquee-pause group relative overflow-hidden border-t border-border [mask-image:linear-gradient(90deg,transparent,black_8%,black_92%,transparent)]">
        <div className="animate-marquee flex w-max">
          {row.map((p, i) => {
            const Icon = p.icon
            return (
              <div
                key={i}
                className="group/cell relative flex h-28 w-52 shrink-0 flex-col items-center justify-center gap-2.5 border-r border-border"
              >
                <ArrowUpRight className="absolute right-4 top-4 h-3.5 w-3.5 text-muted-foreground/40 transition-colors group-hover/cell:text-primary" />
                <Icon className="h-6 w-6 text-foreground/70 transition-colors group-hover/cell:text-foreground" />
                <span className="text-sm font-semibold tracking-tight text-foreground/90">
                  {p.name}
                </span>
                {/* caramel underline accent */}
                <span className="absolute inset-x-0 bottom-0 h-0.5 origin-left scale-x-0 bg-primary transition-transform duration-300 group-hover/cell:scale-x-100" />
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
