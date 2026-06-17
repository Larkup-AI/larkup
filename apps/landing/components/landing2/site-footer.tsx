import { Code2, Send } from "lucide-react"
import { BrewMark } from "@/components/landing2/brew-mark"

const groups = [
  {
    title: "Product",
    links: ["Features", "Pipeline", "Connectors", "Pricing", "Changelog"],
  },
  {
    title: "Developers",
    links: ["Documentation", "API reference", "Examples", "SDKs", "Status"],
  },
  {
    title: "Company",
    links: ["About", "Blog", "Careers", "Contact", "Security"],
  },
]

export function SiteFooter() {
  return (
    <footer className="border-t border-border/60">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div>
            <a href="#" className="flex items-center gap-2.5">
              <BrewMark className="h-7 w-7 text-primary" />
              <span className="text-lg font-semibold tracking-tight">Brew</span>
            </a>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">
              The open-source RAG framework for grounded, production-grade AI
              retrieval.
            </p>
            <div className="mt-5 flex items-center gap-2">
              <a
                href="#"
                aria-label="GitHub"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-secondary/60 transition-colors hover:bg-accent"
              >
                <Code2 className="h-[18px] w-[18px]" />
              </a>
              <a
                href="#"
                aria-label="Twitter"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-secondary/60 transition-colors hover:bg-accent"
              >
                <Send className="h-[18px] w-[18px]" />
              </a>
            </div>
          </div>

          {groups.map((g) => (
            <div key={g.title}>
              <h3 className="text-sm font-semibold">{g.title}</h3>
              <ul className="mt-4 space-y-3">
                {g.links.map((l) => (
                  <li key={l}>
                    <a
                      href="#"
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {l}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-border/60 pt-8 text-sm text-muted-foreground sm:flex-row">
          <p>© {new Date().getFullYear()} Brew Labs, Inc. All rights reserved.</p>
          <div className="flex items-center gap-6">
            <a href="#" className="transition-colors hover:text-foreground">
              Privacy
            </a>
            <a href="#" className="transition-colors hover:text-foreground">
              Terms
            </a>
            <a href="#" className="transition-colors hover:text-foreground">
              MIT License
            </a>
          </div>
        </div>
      </div>
    </footer>
  )
}
