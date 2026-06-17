import { ArrowRight } from "lucide-react"

const DEPLOY_OPTIONS = [
  {
    title: "Docker",
    description:
      "Auto-generated Dockerfile and docker-compose.yml included. Build and ship a container in seconds.",
    badge: "Included",
    code: "docker compose up -d",
  },
  {
    title: "Vercel",
    description:
      "Ships with vercel.json ready to go. Push to git and deploy — zero config needed.",
    badge: "Included",
    code: "vercel deploy",
  },
  {
    title: "Bare Node",
    description:
      "Plain ESM server — node server.mjs. No build step required. Runs anywhere Node does.",
    badge: "Default",
    code: "node server.mjs",
  },
]

const STATS = [
  { value: "~50 KB", label: "Generated server" },
  { value: "0", label: "Build steps" },
  { value: "2", label: "REST endpoints" },
]

export function DeploySection() {
  return (
    <section className="border-t border-border" id="deploy">
      {/* Section label */}
      <div className="border-b border-border">
        <div className="mx-auto max-w-6xl px-6 py-3 flex items-center gap-3 font-mono text-[11px] text-muted-foreground/60">
          <span>[ 03 / 05 ]</span>
          <span>·</span>
          <span>DEPLOYMENT</span>
        </div>
      </div>

      <div className="mx-auto max-w-6xl border-l border-border">
        {/* Top row — deploy options */}
        <div className="grid grid-cols-1 md:grid-cols-3 border-b border-border">
          {DEPLOY_OPTIONS.map((opt, i) => (
            <div
              key={opt.title}
              className="border-r border-border last:border-r-0 px-6 py-7 flex flex-col gap-4 hover:bg-secondary/30 transition-colors group"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-foreground">{opt.title}</h3>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-caramel border border-caramel/20 bg-caramel/5 px-2 py-0.5 rounded-full">
                  {opt.badge}
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed flex-1">{opt.description}</p>
              <div className="font-mono text-xs text-muted-foreground/70 bg-secondary/40 border border-border px-3 py-2 rounded-lg">
                $ {opt.code}
              </div>
              <button className="size-7 rounded-full border border-border flex items-center justify-center text-muted-foreground group-hover:border-caramel/40 group-hover:text-caramel group-hover:bg-caramel/5 transition-all self-start">
                <ArrowRight className="size-3.5" />
              </button>
            </div>
          ))}
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 border-b border-border">
          {STATS.map((stat, i) => (
            <div
              key={stat.label}
              className="border-r border-border last:border-r-0 px-6 py-6 text-center"
            >
              <p className="text-2xl font-bold text-caramel">{stat.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{stat.label}</p>
            </div>
          ))}
        </div>

        {/* CTA row */}
        <div className="px-6 py-10 text-center border-r border-border">
          <p className="text-xs font-mono text-muted-foreground/50 uppercase tracking-widest mb-6">
            Ready to build?
          </p>
          <a
            href="#"
            className="inline-flex items-center gap-2 px-7 py-3 text-sm font-semibold text-white bg-caramel hover:bg-caramel-dark rounded-lg transition-colors"
          >
            Start Building Your Pipeline
            <ArrowRight className="size-4" />
          </a>
          <p className="mt-4 text-xs text-muted-foreground">
            Open source · MIT License · No credit card needed
          </p>
        </div>
      </div>
    </section>
  )
}
