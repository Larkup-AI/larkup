"use client"

import { useState } from "react"
import { Check, Loader2, Mail } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

const perks = [
  "A guided tour of the retrieval pipeline",
  "Architecture review for your use case",
  "Migration help from your current stack",
]

export function ContactSection() {
  const [status, setStatus] = useState<"idle" | "loading" | "done">("idle")

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus("loading")
    setTimeout(() => setStatus("done"), 1100)
  }

  return (
    <section id="contact" className="pt-32 pb-20 sm:pt-40 sm:pb-28">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:gap-16 lg:px-8">
        {/* Left copy */}
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-primary">
            Talk to us
          </p>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Let&apos;s get your RAG into production
          </h2>
          <p className="mt-4 text-pretty leading-relaxed text-muted-foreground">
            Tell us what you&apos;re building and we&apos;ll help you design a
            retrieval architecture that scales. Open source forever — enterprise
            support when you need it.
          </p>

          <ul className="mt-8 space-y-3">
            {perks.map((p) => (
              <li key={p} className="flex items-start gap-3 text-sm">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                  <Check className="h-3 w-3" />
                </span>
                <span className="text-muted-foreground">{p}</span>
              </li>
            ))}
          </ul>

          <div className="mt-8 flex items-center gap-2 text-sm text-muted-foreground">
            <Mail className="h-4 w-4 text-primary" />
            hello@brew.dev
          </div>
        </div>

        {/* Form card */}
        <div className="rounded-2xl border border-border bg-card p-6 sm:p-8">
          {status === "done" ? (
            <div className="flex h-full min-h-[360px] flex-col items-center justify-center text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary">
                <Check className="h-6 w-6" />
              </div>
              <h3 className="mt-4 text-xl font-semibold">Message sent</h3>
              <p className="mt-2 max-w-xs text-sm text-muted-foreground">
                Thanks for reaching out — we&apos;ll get back to you within one
                business day.
              </p>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-5">
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" name="name" placeholder="Ada Lovelace" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Work email</Label>
                  <Input id="email" name="email" type="email" placeholder="ada@company.com" required />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="company">Company</Label>
                <Input id="company" name="company" placeholder="Acme Inc." />
              </div>
              <div className="space-y-2">
                <Label htmlFor="message">What are you building?</Label>
                <Textarea
                  id="message"
                  name="message"
                  rows={4}
                  placeholder="We want to add grounded answers to our support product…"
                  required
                />
              </div>
              <Button type="submit" size="lg" className="w-full" disabled={status === "loading"}>
                {status === "loading" ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Sending…
                  </>
                ) : (
                  "Send message"
                )}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                We&apos;ll never share your details. No spam, ever.
              </p>
            </form>
          )}
        </div>
      </div>
    </section>
  )
}
