import Image from "next/image"

const providers = [
  { name: "AWS", src: "/icons/aws.svg" },
  { name: "Azure", src: "/icons/azure.svg" },
  { name: "Chroma", src: "/icons/chroma.png" },
  { name: "Cohere", src: "/icons/cohere.svg" },
  { name: "DeepSeek", src: "/icons/deepseek.svg" },
  { name: "Digital Ocean", src: "/icons/digital-ocean.webp" },
  { name: "Docker", src: "/icons/docker.png" },
  { name: "GCP", src: "/icons/gcp.svg" },
  { name: "Gemini", src: "/icons/gemini.svg" },
  { name: "GitHub", src: "/icons/github.svg" },
  { name: "Google", src: "/icons/google.png" },
  { name: "Groq", src: "/icons/groq-light.png" },
  { name: "Hetzner", src: "/icons/hetzner.svg" },
  { name: "Jina", src: "/icons/jina.svg" },
  { name: "LanceDB", src: "/icons/lancedb2.png" },
  { name: "Milvus", src: "/icons/milvus.png" },
  { name: "Mistral", src: "/icons/mistral.svg" },
  { name: "Nomic", src: "/icons/nomic.png" },
  { name: "OpenAI", src: "/icons/openai.svg" },
  { name: "PGVector", src: "/icons/pgvector2.png" },
  { name: "Pinecone", src: "/icons/pinecone.png" },
  { name: "Qdrant", src: "/icons/qdrant.svg" },
  { name: "Qwen", src: "/icons/qwen-color.svg" },
  { name: "Supabase", src: "/icons/supabase.png" },
  { name: "Vercel", src: "/icons/vercel.svg" },
  { name: "Voyage", src: "/icons/voyage-light.png" },
  { name: "Weaviate", src: "/icons/weaviate.webp" },
  { name: "xAI", src: "/icons/xai.svg" },
]

export function ProviderMarquee() {
  const row = [...providers, ...providers]

  return (
    <section id="providers" className="border-y border-border bg-card/10">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <p className="text-center text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground">
          Plug into every model &amp; vector store
        </p>
      </div>

      <div className="marquee-pause group relative overflow-hidden border-t border-bordermask-[linear-gradient(90deg,transparent,black_8%,black_92%,transparent)]">
        <div className="animate-marquee flex w-max">
          {row.map((p, i) => {
            return (
              <div
                key={i}
                className="group/cell relative flex h-28 w-56 shrink-0 flex-row items-center justify-center gap-3 border-r border-border hover:bg-card/50 transition-colors"
              >
                <Image src={p.src} alt={p.name} width={28} height={28} className="h-7 w-auto object-contain" />
                <span className="text-lg font-semibold tracking-tight text-foreground/90">
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
