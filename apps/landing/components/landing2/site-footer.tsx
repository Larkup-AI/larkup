import { Code2, Send, Mail } from "lucide-react"
import Image from "next/image"

const groups = [
  {
    title: "Platform",
    links: [
      { label: "About Us", href: "https://buddyhere.de/about" },
      { label: "Features", href: "/features" },
      { label: "Contact", href: "/contact" }
    ],
  },
  {
    title: "Support",
    links: [
      { label: "Safety Center", href: "https://buddyhere.de/safety" },
      { label: "Community Guidelines", href: "https://buddyhere.de/guidelines" },
      { label: "Help Center", href: "https://buddyhere.de/help" }
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy Policy", href: "https://buddyhere.de/privacy" },
      { label: "Terms of Service", href: "https://buddyhere.de/terms" },
      { label: "Cookies", href: "https://buddyhere.de/cookies" }
    ],
  },
]

export function SiteFooter() {
  return (
    <footer className="border-t border-border/60">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div>
            <a href="#" className="flex items-center gap-2.5">
              <Image src="/logos/logo7.png" alt="Buddy Here Logo" width={28} height={28} className="h-7 w-auto object-contain dark:invert" />
              <span className="text-lg font-semibold tracking-tight">Buddy Here</span>
            </a>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">
              Connecting university students worldwide. We believe in the power of shared experiences and local knowledge.
            </p>

            <div className="mt-4 flex flex-col gap-2 text-sm text-muted-foreground">
              <a href="mailto:info@buddyhere.de" className="hover:text-foreground transition-colors">info@buddyhere.de</a>
              <a href="mailto:help@buddyhere.de" className="hover:text-foreground transition-colors">help@buddyhere.de</a>
            </div>
          </div>

          {groups.map((g) => (
            <div key={g.title}>
              <h3 className="text-sm font-semibold">{g.title}</h3>
              <ul className="mt-4 space-y-3">
                {g.links.map((l) => (
                  <li key={l.label}>
                    <a
                      href={l.href}
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-border/60 pt-8 text-sm text-muted-foreground sm:flex-row">
          <p>© {new Date().getFullYear()} Buddy Here UG. All rights reserved.</p>
          <div className="flex items-center gap-6">
       
            <div className="flex items-center gap-2">
              <a
                href="mailto:info@buddyhere.de"
                aria-label="General Contact"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-secondary/60 transition-colors hover:bg-accent"
              >
                <Mail className="h-[18px] w-[18px]" />
              </a>
              <a
                href="https://www.linkedin.com/company/buddy-here/"
                aria-label="LinkedIn"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-secondary/60 transition-colors hover:bg-accent"
              >
                <Image src="/icons/linkedin.png" alt="LinkedIn" width={18} height={18} className="h-[18px] w-[18px] object-contain" />
              </a>
              <a
                href="https://instagram.com"
                aria-label="Instagram"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-secondary/60 transition-colors hover:bg-accent"
              >
                <Image src="/icons/instagram.png" alt="Instagram" width={18} height={18} className="h-[18px] w-[18px] object-contain" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  )
}
