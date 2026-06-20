"use client"

import { useState } from "react"
import { Menu, X, ExternalLink } from "lucide-react"
import { ThemeToggle } from "@/components/theme-toggle"

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  )
}

const NAV_LINKS = [
  { label: "Features", href: "#features" },
  { label: "Pipeline", href: "#pipeline" },
  { label: "Deploy", href: "#deploy" },
  { label: "Docs", href: "#", external: true },
]

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <header className="sticky top-0 left-0 z-50 w-full bg-transparent backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        {/* Logo */}
        <a href="#" className="group flex items-center gap-2.5">
          <div className="relative flex size-8 items-center justify-center rounded-lg bg-caramel shadow-[0_0_20px_rgba(26,107,255,0.3)] transition-shadow group-hover:shadow-[0_0_28px_rgba(26,107,255,0.45)]">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <span className="text-lg font-semibold tracking-tight">
            Larkup<span className="gradient-text">RAG</span>
          </span>
        </a>

        {/* Desktop Nav */}
        <nav className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="group relative rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-caramel-muted hover:text-foreground"
            >
              {link.label}
              {link.external && (
                <ExternalLink className="ml-1 inline-block size-3 opacity-50" />
              )}
            </a>
          ))}
        </nav>

        {/* Desktop CTA */}
        <div className="hidden items-center gap-3 md:flex">
          <ThemeToggle />
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-caramel-muted hover:text-foreground"
          >
            <GithubIcon className="size-4" />
            <span className="text-xs font-medium opacity-60">Star</span>
          </a>
          <a
            href="#"
            className="inline-flex items-center justify-center rounded-lg bg-caramel px-5 py-2 text-sm font-medium text-white shadow-[0_0_20px_rgba(26,107,255,0.25)] transition-all hover:bg-caramel-dark hover:shadow-[0_0_30px_rgba(26,107,255,0.4)] active:scale-[0.98]"
          >
            Get Started
          </a>
        </div>

        {/* Mobile toggle */}
        <div className="flex items-center gap-2 md:hidden">
          <ThemeToggle />
          <button
            className="p-2 text-foreground"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle menu"
          >
            {mobileOpen ? (
              <X className="size-5" />
            ) : (
              <Menu className="size-5" />
            )}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="border-t border-border bg-background/95 backdrop-blur-xl md:hidden">
          <nav className="flex flex-col gap-1 p-4">
            {NAV_LINKS.map((link) => (
              <a
                key={link.label}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className="rounded-lg px-4 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-caramel-muted hover:text-foreground"
              >
                {link.label}
              </a>
            ))}
            <div className="mt-2 border-t border-border pt-3">
              <a
                href="#"
                className="block rounded-lg bg-caramel px-5 py-2.5 text-center text-sm font-medium text-white"
              >
                Get Started
              </a>
            </div>
          </nav>
        </div>
      )}
    </header>
  )
}
