"use client"

import { useState } from "react"
import { Menu, X, Code2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/theme-toggle"
import Image from "next/image"
import Link from "next/link"

const links = [
  { label: "Features", href: "/#how-it-works" },
  { label: "Providers", href: "/#docs" },
  { label: "Pipeline", href: "/#docs" },
  { label: "Contact", href: "/contact" },
]

export function SiteNavbar() {
  const [open, setOpen] = useState(false)

  return (
    <header className="fixed inset-x-0 top-0 z-50">
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <Image src="/logo1.png" alt="Brew Logo" width={28} height={28} className="h-7 w-auto object-contain dark:invert" />
          <span className="text-lg font-semibold tracking-tight">Brew</span>
          <span className="hidden rounded-full border border-border bg-secondary/60 px-2 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline">
            v2.1
          </span>
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {links.map((link,index) => (
            <Link
              key={`${link.href}-${index}`}
              href={link.href}
              className="rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="hidden items-center gap-2 md:flex">
          <ThemeToggle />
          <a
            href="#"
            aria-label="GitHub repository"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-secondary/60 text-foreground transition-colors hover:bg-accent"
          >
            <Code2 className="h-[18px] w-[18px]" />
          </a>
          <Button asChild size="sm">
            <Link href="/contact">Start brewing</Link>
          </Button>
        </div>

        <div className="flex items-center gap-2 md:hidden">
          <ThemeToggle />
          <button
            type="button"
            aria-label="Toggle menu"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-secondary/60 text-foreground"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </nav>

      {open && (
        <div className="border-t border-border/60 bg-background/95 px-4 pb-4 pt-2 md:hidden">
          <div className="flex flex-col">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {link.label}
              </Link>
            ))}
            <Button asChild size="sm" className="mt-2">
              <Link href="/contact" onClick={() => setOpen(false)}>
                Start brewing
              </Link>
            </Button>
          </div>
        </div>
      )}
    </header>
  )
}
